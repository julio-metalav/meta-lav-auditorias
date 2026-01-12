"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor" | null;

type Me = {
  user: { id: string; email: string };
  role: Role;
};

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref?: string | null;
  ano_mes?: string | null; // compat
  status: string | null;
  auditor_id: string | null;

  condominios?: { id?: string; nome: string; cidade: string; uf: string } | null;
  profiles?: { id?: string; email?: string | null; role?: string | null } | null;
};

type Filtro = "a_fazer" | "concluidas" | "todas";

function pickMonth(a: Aud) {
  return (a.mes_ref ?? a.ano_mes ?? "") as string;
}

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  const txt = await res.text().catch(() => "");
  if (!txt) return {};
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(txt);
    } catch {
      return { _raw: txt };
    }
  }
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function isConcluida(status: any) {
  // regra simples: "final" = concluída
  return norm(status) === "final";
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário");
      setMe(meJson as Me);

      const res = await fetch("/api/auditorias", { cache: "no-store" });
      const json = await safeJson(res);
      if (!res.ok) throw new Error((json as any)?.error ?? "Erro ao carregar auditorias");

      // ✅ aceita os 2 formatos:
      // - array direto: [...]
      // - envelopado: { data: [...] }
      const list: Aud[] = Array.isArray(json) ? (json as Aud[]) : ((json as any)?.data ?? []);
      setAuditorias(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
      setAuditorias([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const isStaff = useMemo(() => me?.role === "interno" || me?.role === "gestor", [me?.role]);

  const auditoriasFiltradas = useMemo(() => {
    const qq = norm(q);

    let list = [...auditorias];

    // filtro "a fazer" / "concluídas"
    if (filtro === "a_fazer") list = list.filter((a) => !isConcluida(a.status));
    if (filtro === "concluidas") list = list.filter((a) => isConcluida(a.status));

    // busca
    if (qq) {
      list = list.filter((a) => {
        const condo = a.condominios ? `${a.condominios.nome} ${a.condominios.cidade} ${a.condominios.uf}` : "";
        const auditor = a.profiles?.email ?? "";
        const month = pickMonth(a);
        const id = a.id ?? "";
        const condId = a.condominio_id ?? "";

        const hay = norm(`${condo} ${auditor} ${month} ${id} ${condId} ${a.status ?? ""}`);
        return hay.includes(qq);
      });
    }

    // ordena por mês desc, depois por condomínio
    list.sort((a, b) => {
      const am = pickMonth(a);
      const bm = pickMonth(b);
      if (am !== bm) return String(bm).localeCompare(String(am));
      const an = a.condominios?.nome ?? "";
      const bn = b.condominios?.nome ?? "";
      return String(an).localeCompare(String(bn));
    });

    return list;
  }, [auditorias, filtro, q]);

  function hrefAbrir(a: Aud) {
    if (me?.role === "auditor") return `/auditor/auditoria/${a.id}`;
    return `/interno/auditoria/${a.id}`;
  }

  return (
    <AppShell title="Auditorias">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Auditorias</h1>
            <div className="mt-1 text-sm text-gray-600">
              {me?.role === "auditor" ? "Minhas auditorias (auditor)" : "Lista (interno/gestor)"}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Debug: carregadas {auditorias.length} auditorias • no filtro {auditoriasFiltradas.length}
            </div>
          </div>

          <div className="flex gap-2">
            {isStaff && (
              <button
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
                onClick={() => router.push("/auditorias/nova")}
                disabled={loading}
                title="Criar nova auditoria"
              >
                + Nova auditoria
              </button>
            )}

            <button
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={carregar}
              disabled={loading}
              title="Recarregar"
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="w-full max-w-md rounded-xl border px-4 py-2 text-sm"
            placeholder="Buscar condomínio, auditor, ID..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="rounded-xl border px-4 py-2 text-sm"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
          >
            <option value="a_fazer">A fazer</option>
            <option value="concluidas">Concluídas</option>
            <option value="todas">Todas</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2">Mês</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Auditor</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>

          <div className="divide-y">
            {auditoriasFiltradas.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
            )}

            {auditoriasFiltradas.map((a) => {
              const c = a.condominios;
              const condoLabel = c ? `${c.nome} - ${c.cidade}/${c.uf}` : a.condominio_id;
              const month = pickMonth(a) || "—";
              const st = a.status ?? "—";
              const auditorEmail = a.profiles?.email ?? "—";

              return (
                <div key={a.id} className="grid grid-cols-12 items-center px-4 py-3 text-sm">
                  <div className="col-span-5 min-w-0">
                    <div className="font-medium truncate">{condoLabel}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      ID: <span className="font-mono">{a.id}</span>
                    </div>
                  </div>

                  <div className="col-span-2 text-gray-800">{month}</div>

                  <div className="col-span-2">
                    <span
                      className={[
                        "inline-flex rounded-full border px-2 py-1 text-xs",
                        isConcluida(st) ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-700",
                      ].join(" ")}
                    >
                      {st}
                    </span>
                  </div>

                  <div className="col-span-2 truncate text-gray-700">{auditorEmail}</div>

                  <div className="col-span-1 flex justify-end">
                    <Link
                      href={hrefAbrir(a)}
                      className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                      title="Abrir auditoria"
                    >
                      Abrir
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-700">
          <b>Obs:</b>
          <br />
          Auditor faz campo (leituras/fotos) e conclui. Interno lança ciclos, gera relatório financeiro e anexa comprovante.
        </div>
      </div>
    </AppShell>
  );
}
