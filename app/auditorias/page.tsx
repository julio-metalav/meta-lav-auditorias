"use client";

import { BuildTag } from "@/app/components/BuildTag";
import { useEffect, useMemo, useState } from "react";

type Role = "auditor" | "interno" | "gestor";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type Condo = { id: string; nome: string; cidade: string; uf: string };
type AuditorUser = { id: string; email?: string | null; role?: Role | null };

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;
  created_at?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null; role?: Role | null } | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function pickMonth(a: Aud) {
  return (a.mes_ref ?? a.ano_mes ?? "") as string;
}

function statusLabel(s: string | null) {
  const x = String(s ?? "").toLowerCase();
  if (x === "aberta") return "Aberta";
  if (x === "em_andamento") return "Em andamento";
  if (x === "em_conferencia") return "Em conferência";
  if (x === "final") return "Final";
  return s ?? "-";
}

function badgeClass(s: string | null) {
  const x = String(s ?? "").toLowerCase();
  if (x === "aberta") return "bg-gray-100 text-gray-800";
  if (x === "em_andamento") return "bg-blue-100 text-blue-800";
  if (x === "em_conferencia") return "bg-yellow-100 text-yellow-900";
  if (x === "final") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

export default function AuditoriasPage() {
  const [me, setMe] = useState<Me | null>(null);

  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [auditores, setAuditores] = useState<AuditorUser[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
  });

  const condoLabel = useMemo(() => {
    const m = new Map<string, string>();
    condos.forEach((c) => m.set(c.id, `${c.nome} • ${c.cidade}/${c.uf}`));
    return m;
  }, [condos]);

  const auditorEmailById = useMemo(() => {
    const m = new Map<string, string>();
    auditores.forEach((u) => m.set(u.id, u.email ?? u.id));
    return m;
  }, [auditores]);

  async function carregar() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao carregar /api/me");
      setMe(meJson as Me);

      const [aRes, cRes] = await Promise.all([
        fetch("/api/auditorias", { cache: "no-store" }),
        fetch("/api/condominios", { cache: "no-store" }),
      ]);

      const aJson = await safeJson(aRes);
      if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar auditorias");

      const cJson = await safeJson(cRes);
      if (cRes.ok) setCondos(Array.isArray(cJson) ? (cJson as Condo[]) : (cJson?.data ?? []));

      const list: Aud[] = Array.isArray(aJson) ? (aJson as Aud[]) : (aJson?.data ?? []);
      list.sort((x, y) => {
        const mx = pickMonth(x) ?? "";
        const my = pickMonth(y) ?? "";
        if (mx !== my) return my.localeCompare(mx);
        const cx = x.created_at ?? "";
        const cy = y.created_at ?? "";
        return cy.localeCompare(cx);
      });
      setAuditorias(list);

      try {
        const uRes = await fetch("/api/users", { cache: "no-store" });
        const uJson = await safeJson(uRes);
        if (uRes.ok) {
          const arr = Array.isArray(uJson) ? uJson : uJson?.data ?? [];
          setAuditores((arr as AuditorUser[]).filter((u) => u.role === "auditor"));
        }
      } catch {
        // ignora
      }
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function criarAuditoria() {
    setErr(null);
    setOk(null);

    if (!form.condominio_id) return setErr("Selecione um condomínio.");
    if (!form.ano_mes) return setErr("Informe o mês (YYYY-MM-01).");
    if (!form.auditor_id) return setErr("Selecione o auditor (obrigatório).");

    setSaving(true);
    try {
      const res = await fetch("/api/auditorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condominio_id: form.condominio_id,
          ano_mes: form.ano_mes,
          status: "aberta",
          auditor_id: form.auditor_id || null,
        }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao criar auditoria");

      setOk("Auditoria criada ✅");
      setForm((p) => ({ ...p, condominio_id: "" }));
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao criar");
    } finally {
      setSaving(false);
    }
  }

  async function reabrirAuditoria(id: string) {
    const motivo = window.prompt("Motivo da reabertura (obrigatório):");
    if (!motivo || !motivo.trim()) return;

    setErr(null);
    setOk(null);

    try {
      const res = await fetch(`/api/auditorias/${id}/reabrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao reabrir auditoria");

      setOk("Auditoria reaberta ✅");
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao reabrir");
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Auditorias</h1>
          <div className="text-xs text-gray-500">Lista (interno/gestor)</div>
        </div>

        <button
          className="shrink-0 rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={carregar}
          disabled={loading || saving}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

      {/* Criar auditoria */}
      <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-800">Criar auditoria</div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Condomínio</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.condominio_id}
              onChange={(e) => setForm((p) => ({ ...p, condominio_id: e.target.value }))}
              disabled={saving || loading}
            >
              <option value="">Selecione…</option>
              {condos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} • {c.cidade}/{c.uf}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Mês (YYYY-MM-01)</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={form.ano_mes}
              onChange={(e) => setForm((p) => ({ ...p, ano_mes: e.target.value }))}
              disabled={saving || loading}
              placeholder="2026-01-01"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Auditor (obrigatório)</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.auditor_id}
              onChange={(e) => setForm((p) => ({ ...p, auditor_id: e.target.value }))}
              disabled={saving || loading}
            >
              <option value="">—</option>
              {auditores.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email ?? u.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <button
            className="w-full rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 md:w-auto"
            onClick={criarAuditoria}
            disabled={saving || loading}
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>

      {/* LISTA - MOBILE (cards) */}
      <div className="space-y-3 md:hidden">
        {auditorias.map((a) => {
          const condo =
            a.condominios?.nome
              ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
              : condoLabel.get(a.condominio_id) ?? a.condominio_id;

          const status = a.status ?? "-";
          const audLabel =
            (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
            a.profiles?.email ??
            (a.auditor_id ?? "—");

          const isEmConferencia = String(a.status ?? "").toLowerCase() === "em_conferencia";
          const isFinal = String(a.status ?? "").toLowerCase() === "final";
          const podeReabrir = isEmConferencia || isFinal;

          return (
            <div key={a.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900">{condo}</div>
                <div className="mt-1 font-mono text-[11px] text-gray-400">{a.id}</div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">Mês:</span>
                <span className="font-semibold text-gray-800">{pickMonth(a) || "-"}</span>

                <span className="ml-2 text-gray-500">Status:</span>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(status)}`}>
                  {statusLabel(status)}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                <span className="text-gray-500">Auditor:</span> <span className="font-semibold">{audLabel}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a className="flex-1 rounded-xl border px-3 py-2 text-center text-sm hover:bg-gray-50" href={`/interno/auditoria/${a.id}`}>
                  Abrir
                </a>

                <button
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    podeReabrir ? "bg-orange-600 hover:bg-orange-700" : "bg-orange-300"
                  }`}
                  onClick={() => reabrirAuditoria(a.id)}
                  disabled={!podeReabrir || loading || saving}
                  title={podeReabrir ? "Reabrir auditoria" : "Só reabre quando estiver em conferência ou final"}
                >
                  Reabrir
                </button>
              </div>
            </div>
          );
        })}

        {!loading && auditorias.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">Nenhuma auditoria encontrada.</div>
        )}
      </div>

      {/* LISTA - DESKTOP (tabela) */}
      <div className="hidden overflow-hidden rounded-2xl border bg-white shadow-sm md:block">
        <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600">
          <div className="col-span-4">Condomínio</div>
          <div className="col-span-2">Mês</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Auditor</div>
          <div className="col-span-2 text-right">Ações</div>
        </div>

        <div className="divide-y">
          {auditorias.map((a) => {
            const condo =
              a.condominios?.nome
                ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
                : condoLabel.get(a.condominio_id) ?? a.condominio_id;

            const status = a.status ?? "-";
            const audLabel =
              (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
              a.profiles?.email ??
              (a.auditor_id ?? "—");

            const isEmConferencia = String(a.status ?? "").toLowerCase() === "em_conferencia";
            const isFinal = String(a.status ?? "").toLowerCase() === "final";
            const podeReabrir = isEmConferencia || isFinal;

            return (
              <div key={a.id} className="grid grid-cols-12 items-center gap-2 px-4 py-3">
                <div className="col-span-4 min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900">{condo}</div>
                  <div className="mt-1 font-mono text-[11px] text-gray-400">{a.id}</div>
                </div>

                <div className="col-span-2 text-sm text-gray-700">{pickMonth(a) || "-"}</div>

                <div className="col-span-2">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>

                <div className="col-span-2 truncate text-sm text-gray-700">{audLabel}</div>

                <div className="col-span-2 flex justify-end gap-2">
                  <a className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-gray-50" href={`/interno/auditoria/${a.id}`}>
                    Abrir
                  </a>

                  <button
                    className={`rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                      podeReabrir ? "bg-orange-600 hover:bg-orange-700" : "bg-orange-300"
                    }`}
                    onClick={() => reabrirAuditoria(a.id)}
                    disabled={!podeReabrir || loading || saving}
                    title={podeReabrir ? "Reabrir auditoria" : "Só reabre quando estiver em conferência ou final"}
                  >
                    Reabrir
                  </button>
                </div>
              </div>
            );
          })}

          {!loading && auditorias.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria encontrada.</div>
          )}
        </div>
      </div>

      {/* rodapé técnico (aparece só se NEXT_PUBLIC_BUILD_TAG estiver setado) */}
      <BuildTag />

      {/* só pra não dar “unused” se você decidir usar o me depois */}
      {me ? null : null}
    </div>
  );
}
