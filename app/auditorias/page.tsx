// app/auditorias/page.tsx
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
  created_at?: string | null;

  // joins (podem vir sem id, então NÃO dependa de condominios.id)
  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null; role?: Role | null } | null;
};

function monthLabel(a: Aud) {
  return (a.mes_ref ?? a.ano_mes ?? "") as string;
}

function statusLabel(s: any) {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v) return "—";
  return v;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

export default function AuditoriasPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "a_fazer" | "concluidas">("todas");

  const isStaff = useMemo(() => {
    const r = me?.role ?? null;
    return r === "interno" || r === "gestor";
  }, [me?.role]);

  async function carregar() {
    setLoading(true);
    setErr(null);

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário");
      setMe(meJson as Me);

      const aRes = await fetch("/api/auditorias", { cache: "no-store" });
      const aJson = await safeJson(aRes);
      if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar auditorias");

      const list = Array.isArray(aJson) ? (aJson as Aud[]) : (aJson?.auditorias ?? []);
      setAuditorias(list ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // label do condomínio sem depender de condominios.id
  const condoLabelByAuditoriaId = useMemo(() => {
    const m = new Map<string, string>();
    auditorias.forEach((a) => {
      const c = a.condominios;
      const label = c ? `${c.nome} - ${c.cidade}/${c.uf}` : a.condominio_id;
      m.set(a.id, label);
    });
    return m;
  }, [auditorias]);

  const filtradas = useMemo(() => {
    const term = q.trim().toLowerCase();

    const base = auditorias.filter((a) => {
      if (filtro === "a_fazer") return String(a.status ?? "").toLowerCase() !== "final";
      if (filtro === "concluidas") return String(a.status ?? "").toLowerCase() === "final";
      return true;
    });

    if (!term) return base;

    return base.filter((a) => {
      const condo = condoLabelByAuditoriaId.get(a.id) ?? "";
      const auditorEmail = a.profiles?.email ?? "";
      const mes = monthLabel(a) ?? "";
      return (
        String(a.id).toLowerCase().includes(term) ||
        String(a.condominio_id).toLowerCase().includes(term) ||
        String(condo).toLowerCase().includes(term) ||
        String(auditorEmail).toLowerCase().includes(term) ||
        String(mes).toLowerCase().includes(term)
      );
    });
  }, [auditorias, q, filtro, condoLabelByAuditoriaId]);

  function abrir(a: Aud) {
    // interno/gestor abre “fechamento”
    if (isStaff) return router.push(`/interno/auditoria/${a.id}`);
    // auditor abre “campo”
    return router.push(`/auditor/auditoria/${a.id}`);
  }

  return (
    <AppShell title="Auditorias">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Auditorias</h1>
            <div className="mt-1 text-sm text-gray-600">
              {isStaff ? "Lista (interno/gestor)" : "Minhas auditorias (auditor)"}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Debug: carregadas {auditorias.length} auditorias • no filtro {filtradas.length}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* ✅ CTA: criar auditoria (só interno/gestor) */}
            {isStaff && (
              <Link
                href="/auditorias/nova"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                title="Criar nova auditoria"
              >
                + Nova auditoria
              </Link>
            )}

            <button
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={carregar}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="w-full max-w-md rounded-2xl border px-4 py-2 text-sm"
            placeholder="Buscar condomínio, auditor, ID..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="rounded-2xl border px-4 py-2 text-sm"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as any)}
          >
            <option value="todas">Todas</option>
            <option value="a_fazer">A fazer</option>
            <option value="concluidas">Concluídas</option>
          </select>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2">Mês</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Auditor</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>

          <div className="divide-y">
            {filtradas.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
            )}

            {filtradas.map((a) => {
              const condoLabel = condoLabelByAuditoriaId.get(a.id) ?? a.condominio_id;
              const auditorEmail = a.profiles?.email ?? "—";
              const mes = monthLabel(a);
              return (
                <div key={a.id} className="grid grid-cols-12 items-center px-4 py-3 text-sm">
                  <div className="col-span-5 min-w-0">
                    <div className="font-semibold truncate">{condoLabel}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      ID: <span className="font-mono">{isUuid(a.id) ? a.id : String(a.id)}</span>
                    </div>
                  </div>

                  <div className="col-span-2 text-gray-700">{mes || "—"}</div>
                  <div className="col-span-2 text-gray-700">{statusLabel(a.status)}</div>
                  <div className="col-span-2 text-gray-700 truncate">{auditorEmail}</div>

                  <div className="col-span-1 flex justify-end">
                    <button
                      className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                      onClick={() => abrir(a)}
                    >
                      Abrir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Observação */}
        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-700">
          <div className="font-semibold">Obs:</div>
          <div className="mt-1 text-gray-600">
            Auditor faz campo (leituras/fotos) e conclui. Interno lança ciclos, gera relatório financeiro e anexa comprovante.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
