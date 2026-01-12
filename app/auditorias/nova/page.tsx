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

type Condo = { id: string; nome: string; cidade: string; uf: string };

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
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

export default function NovaAuditoriaPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState({
    condominio_id: "",
    mes_ref: monthISO(),
    status: "aberta",
  });

  const isStaff = useMemo(() => {
    const r = me?.role ?? null;
    return r === "interno" || r === "gestor";
  }, [me?.role]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // 1) quem sou eu?
        const meRes = await fetch("/api/me", { cache: "no-store" });
        const meJson = await safeJson(meRes);
        if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário");
        setMe(meJson as Me);

        const role = (meJson as Me)?.role ?? null;
        if (role !== "interno" && role !== "gestor") {
          throw new Error("Sem permissão: apenas Interno/Gestor podem criar auditoria.");
        }

        // 2) lista de pontos/condomínios
        const cRes = await fetch("/api/condominios", { cache: "no-store" });
        const cJson = await safeJson(cRes);

        // alguns endpoints devolvem { data: [] }, outros devolvem [] direto
        const list = Array.isArray(cJson) ? (cJson as any[]) : (cJson?.data ?? []);
        const normalized: Condo[] = (list ?? []).map((x: any) => ({
          id: String(x.id),
          nome: String(x.nome ?? ""),
          cidade: String(x.cidade ?? ""),
          uf: String(x.uf ?? ""),
        }));

        setCondos(normalized.filter((x) => isUuid(x.id) && x.nome));
      } catch (e: any) {
        setErr(e?.message ?? "Falha ao carregar");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function criarAuditoria() {
    setErr(null);
    setOk(null);

    if (!isStaff) return setErr("Sem permissão.");
    if (!isUuid(form.condominio_id)) return setErr("Selecione um condomínio válido.");
    if (!form.mes_ref) return setErr("Informe o mês (mes_ref).");

    setCreating(true);
    try {
      const res = await fetch("/api/auditorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condominio_id: form.condominio_id,
          mes_ref: form.mes_ref,
          status: form.status ?? "aberta",
        }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao criar auditoria");

      const aud = (json?.auditoria ?? json) as any;
      const id = String(aud?.id ?? "");

      setOk("Auditoria criada ✅");

      // Fluxo prático:
      // - volta pra lista
      // - o Interno pode depois ir em Atribuições pra definir auditor (se ainda não tiver)
      router.push("/auditorias");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao criar auditoria");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Nova auditoria">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Nova auditoria</h1>
            <div className="mt-1 text-sm text-gray-600">
              Criação de auditoria (Interno/Gestor). Depois você atribui o auditor em <b>Atribuições</b>.
            </div>
          </div>

          <div className="flex gap-2">
            <Link className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" href="/auditorias">
              Voltar
            </Link>
            <Link className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" href="/atribuicoes">
              Atribuições
            </Link>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
        {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Condomínio (ponto)</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={form.condominio_id}
                onChange={(e) => setForm((p) => ({ ...p, condominio_id: e.target.value }))}
                disabled={loading || creating}
              >
                <option value="">Selecione...</option>
                {condos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} - {c.cidade}/{c.uf}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-gray-500">
                Se não aparecer aqui, confira se o condomínio foi criado em <b>Pontos</b> e se o endpoint <code>/api/condominios</code> está retornando.
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Mês de referência (mes_ref)</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={form.mes_ref}
                onChange={(e) => setForm((p) => ({ ...p, mes_ref: e.target.value }))}
                disabled={loading || creating}
                placeholder="YYYY-MM-01"
              />
              <div className="mt-1 text-xs text-gray-500">Formato: <b>YYYY-MM-01</b> (sempre dia 01).</div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Status inicial</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                disabled={loading || creating}
              >
                <option value="aberta">aberta</option>
                <option value="em_andamento">em_andamento</option>
                <option value="em_conferencia">em_conferencia</option>
                <option value="final">final</option>
              </select>
              <div className="mt-1 text-xs text-gray-500">Normal: <b>aberta</b>.</div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={criarAuditoria}
              disabled={loading || creating || !isStaff}
              title={!isStaff ? "Sem permissão" : "Criar auditoria"}
            >
              {creating ? "Criando..." : "Criar auditoria"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
