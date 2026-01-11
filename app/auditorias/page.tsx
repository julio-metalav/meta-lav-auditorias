"use client";

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

type StatusKey = "todas" | "aberta" | "em_andamento" | "em_conferencia" | "final";

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function pickMonth(a: Aud) {
  return (a.mes_ref ?? a.ano_mes ?? "") as string;
}

function normStatus(s: string | null): Exclude<StatusKey, "todas"> | "aberta" {
  const x = String(s ?? "").trim().toLowerCase();
  if (x === "aberta") return "aberta";
  if (x === "em_andamento" || x === "em andamento") return "em_andamento";
  if (x === "em_conferencia" || x === "em conferência" || x === "em conferencia") return "em_conferencia";
  if (x === "final") return "final";
  return "aberta";
}

function statusLabel(s: string | null) {
  const x = normStatus(s);
  if (x === "aberta") return "Aberta";
  if (x === "em_andamento") return "Em andamento";
  if (x === "em_conferencia") return "Em conferência";
  if (x === "final") return "Final";
  return s ?? "-";
}

function badgeClass(s: string | null) {
  const x = normStatus(s);
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

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 hover:bg-gray-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-2xl border bg-white p-4 shadow-xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">{title}</div>
          </div>

          <button
            type="button"
            className="rounded-lg border px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>

        {children}
      </div>
    </div>
  );
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

  // UX: busca + filtro chips
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("todas");

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
  });

  // Modal reabrir
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<Aud | null>(null);
  const [reopenMotivo, setReopenMotivo] = useState("");
  const [reopenSaving, setReopenSaving] = useState(false);

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

  function openReopenModal(a: Aud) {
    setErr(null);
    setOk(null);
    setReopenTarget(a);
    setReopenMotivo("");
    setReopenOpen(true);
  }

  function closeReopenModal() {
    if (reopenSaving) return;
    setReopenOpen(false);
    setReopenTarget(null);
    setReopenMotivo("");
  }

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

  async function confirmarReabrir() {
    const a = reopenTarget;
    if (!a) return;

    const motivo = reopenMotivo.trim();
    if (!motivo) {
      setErr("Motivo da reabertura é obrigatório.");
      return;
    }

    setErr(null);
    setOk(null);
    setReopenSaving(true);

    try {
      const res = await fetch(`/api/auditorias/${a.id}/reabrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao reabrir auditoria");

      setOk("Auditoria reaberta ✅");
      closeReopenModal();
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao reabrir");
    } finally {
      setReopenSaving(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lista filtrada (busca + chips)
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return auditorias.filter((a) => {
      const st = normStatus(a.status);
      if (statusFilter !== "todas" && st !== statusFilter) return false;

      if (!qq) return true;

      const condo =
        a.condominios?.nome
          ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
          : condoLabel.get(a.condominio_id) ?? a.condominio_id;

      const audLabel =
        (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
        a.profiles?.email ??
        (a.auditor_id ?? "—");

      const hay = [
        condo,
        pickMonth(a) || "",
        st,
        a.status ?? "",
        audLabel,
        a.id,
        a.condominio_id,
        a.auditor_id ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(qq);
    });
  }, [auditorias, q, statusFilter, condoLabel, auditorEmailById]);

  // resumo topo
  const summary = useMemo(() => {
    const base = filtered;
    const total = base.length;
    const counts = { aberta: 0, em_andamento: 0, em_conferencia: 0, final: 0 } as Record<
      Exclude<StatusKey, "todas">,
      number
    >;
    for (const a of base) {
      counts[normStatus(a.status)] += 1;
    }
    return { total, counts };
  }, [filtered]);

  const reopenTitle = useMemo(() => {
    if (!reopenTarget) return "Reabrir auditoria";
    const condo =
      reopenTarget.condominios?.nome
        ? `${reopenTarget.condominios.nome} • ${reopenTarget.condominios.cidade}/${reopenTarget.condominios.uf}`
        : condoLabel.get(reopenTarget.condominio_id) ?? reopenTarget.condominio_id;

    return `Reabrir: ${condo}`;
  }, [reopenTarget, condoLabel]);

  const reopenDetails = useMemo(() => {
    if (!reopenTarget) return null;

    const st = normStatus(reopenTarget.status);
    const audLabel =
      (reopenTarget.auditor_id ? auditorEmailById.get(reopenTarget.auditor_id) : null) ??
      reopenTarget.profiles?.email ??
      (reopenTarget.auditor_id ?? "—");

    return {
      mes: pickMonth(reopenTarget) || "-",
      status: statusLabel(reopenTarget.status),
      st,
      auditor: audLabel,
      id: reopenTarget.id,
    };
  }, [reopenTarget, auditorEmailById]);

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
          disabled={loading || saving || reopenSaving}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

      {/* Barra de filtros (chips + busca + resumo) */}
      <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            <Chip active={statusFilter === "todas"} label="Todas" onClick={() => setStatusFilter("todas")} />
            <Chip active={statusFilter === "aberta"} label="Abertas" onClick={() => setStatusFilter("aberta")} />
            <Chip
              active={statusFilter === "em_andamento"}
              label="Em andamento"
              onClick={() => setStatusFilter("em_andamento")}
            />
            <Chip
              active={statusFilter === "em_conferencia"}
              label="Em conferência"
              onClick={() => setStatusFilter("em_conferencia")}
            />
            <Chip active={statusFilter === "final"} label="Final" onClick={() => setStatusFilter("final")} />
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:items-end">
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm md:w-[320px]"
              placeholder="Buscar condomínio, auditor, ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={loading || saving || reopenSaving}
            />

            <div className="text-xs text-gray-600">
              <b>{summary.total}</b> no filtro •{" "}
              <span className="ml-1">Abertas: {summary.counts.aberta}</span> •{" "}
              <span>Em andamento: {summary.counts.em_andamento}</span> •{" "}
              <span>Em conferência: {summary.counts.em_conferencia}</span> •{" "}
              <span>Final: {summary.counts.final}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Criar auditoria */}
      <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-800">Criando auditoria</div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Condomínio</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.condominio_id}
              onChange={(e) => setForm((p) => ({ ...p, condominio_id: e.target.value }))}
              disabled={saving || loading || reopenSaving}
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
              disabled={saving || loading || reopenSaving}
              placeholder="2026-01-01"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Auditor (obrigatório)</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.auditor_id}
              onChange={(e) => setForm((p) => ({ ...p, auditor_id: e.target.value }))}
              disabled={saving || loading || reopenSaving}
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
            disabled={saving || loading || reopenSaving}
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>

      {/* LISTA - MOBILE (cards) */}
      <div className="space-y-3 md:hidden">
        {filtered.map((a) => {
          const condo =
            a.condominios?.nome
              ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
              : condoLabel.get(a.condominio_id) ?? a.condominio_id;

          const status = a.status ?? "-";
          const audLabel =
            (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
            a.profiles?.email ??
            (a.auditor_id ?? "—");

          const st = normStatus(a.status);
          const podeReabrir = st === "em_conferencia" || st === "final";

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
                <a
                  className="flex-1 rounded-xl border px-3 py-2 text-center text-sm hover:bg-gray-50"
                  href={`/interno/auditoria/${a.id}`}
                  title="Abrir (interno)"
                >
                  Abrir
                </a>

                {podeReabrir ? (
                  <button
                    className="flex-1 rounded-xl bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                    onClick={() => openReopenModal(a)}
                    disabled={loading || saving || reopenSaving}
                    title="Reabrir auditoria"
                  >
                    Reabrir
                  </button>
                ) : (
                  <button
                    className="flex-1 cursor-not-allowed rounded-xl bg-orange-200 px-3 py-2 text-sm font-semibold text-orange-900 opacity-70"
                    disabled
                    title="Só reabre quando estiver em conferência ou final"
                  >
                    Reabrir
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
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
          {filtered.map((a) => {
            const condo =
              a.condominios?.nome
                ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
                : condoLabel.get(a.condominio_id) ?? a.condominio_id;

            const status = a.status ?? "-";
            const audLabel =
              (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
              a.profiles?.email ??
              (a.auditor_id ?? "—");

            const st = normStatus(a.status);
            const podeReabrir = st === "em_conferencia" || st === "final";

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
                  <a
                    className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-gray-50"
                    href={`/interno/auditoria/${a.id}`}
                    title="Abrir (interno)"
                  >
                    Abrir
                  </a>

                  {podeReabrir ? (
                    <button
                      className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                      onClick={() => openReopenModal(a)}
                      disabled={loading || saving || reopenSaving}
                      title="Reabrir auditoria"
                    >
                      Reabrir
                    </button>
                  ) : (
                    <button
                      className="cursor-not-allowed rounded-xl bg-orange-200 px-3 py-2 text-xs font-semibold text-orange-900 opacity-70"
                      disabled
                      title="Só reabre quando estiver em conferência ou final"
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
          )}
        </div>
      </div>

      {/* MODAL REABRIR */}
      <Modal open={reopenOpen} title={reopenTitle} onClose={closeReopenModal}>
        {reopenDetails ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-gray-50 p-3 text-xs text-gray-700">
              <div>
                <b>Mês:</b> {reopenDetails.mes}
              </div>
              <div>
                <b>Status atual:</b> {reopenDetails.status}
              </div>
              <div className="truncate">
                <b>Auditor:</b> {reopenDetails.auditor}
              </div>
              <div className="truncate font-mono text-[11px] text-gray-500">
                <b>ID:</b> {reopenDetails.id}
              </div>
            </div>

            <div className="text-sm text-gray-700">
              Ao reabrir, a auditoria volta para edição em campo. Use isso só quando for necessário.
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Motivo da reabertura (obrigatório)</label>
              <textarea
                className="w-full rounded-xl border px-3 py-2 text-sm"
                rows={3}
                value={reopenMotivo}
                onChange={(e) => setReopenMotivo(e.target.value)}
                disabled={reopenSaving}
                placeholder="Ex: Foto de energia ilegível, precisa refazer em campo."
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                onClick={closeReopenModal}
                disabled={reopenSaving}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="flex-1 rounded-xl bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                onClick={confirmarReabrir}
                disabled={reopenSaving || !reopenMotivo.trim()}
                title={!reopenMotivo.trim() ? "Informe o motivo" : "Confirmar reabertura"}
              >
                {reopenSaving ? "Reabrindo..." : "Confirmar reabertura"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Selecione uma auditoria para reabrir.</div>
        )}
      </Modal>

      {/* me fica usado de leve (evita warning se você resolver ligar algo depois) */}
      {me ? null : null}
    </div>
  );
}
