"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

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

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

export default function AuditoriasPage() {
  const [me, setMe] = useState<Me | null>(null);

  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [auditores, setAuditores] = useState<AuditorUser[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todas");

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: "",
    status: "aberta",
    auditor_id: "",
  });

  // mapas auxiliares
  const auditorEmailById = useMemo(() => {
    const m = new Map<string, string>();
    auditores.forEach((u) => m.set(u.id, u.email ?? u.id));
    return m;
  }, [auditores]);

  const condoLabel = useMemo(() => {
    const m = new Map<string, string>();
    auditorias.forEach((a) => {
      const label = a.condominios ? `${a.condominios.nome} - ${a.condominios.cidade}/${a.condominios.uf}` : a.condominio_id;
      m.set(a.condominio_id, label);
    });
    return m;
  }, [auditorias]);

  // role helpers
  const role = (me?.role ?? null) as Role | null;
  const isAuditor = role === "auditor" || role === null; // fallback: se ainda não carregou role, tratar como auditor
  const isInterno = roleGte(role, "interno");
  const isGestor = roleGte(role, "gestor");

  function openHref(a: Aud) {
    // auditor: tela de campo
    if (isAuditor && !isInterno) return `/auditor/auditoria/${a.id}`;
    // interno/gestor: tela operacional
    return `/interno/auditoria/${a.id}`;
  }

  function openTitle() {
    if (isAuditor && !isInterno) return "Abrir (campo)";
    return "Abrir (interno)";
  }

  useEffect(() => {
    let dead = false;

    async function load() {
      setErr(null);
      setOk(null);
      setLoading(true);

      try {
        const [meRes, aRes, uRes] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/auditorias", { cache: "no-store" }),
          fetch("/api/usuarios", { cache: "no-store" }),
        ]);

        const meJson = await meRes.json().catch(() => ({}));
        const aJson = await aRes.json().catch(() => ({}));
        const uJson = await uRes.json().catch(() => ({}));

        if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao carregar usuário");
        if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar auditorias");
        // usuarios pode falhar para auditor (sem permissão). tudo bem.

        if (!dead) {
          setMe(meJson as Me);
          setAuditorias((aJson?.data ?? []) as Aud[]);

          // só popula auditores se vier
          const arr = (uJson?.data ?? []) as AuditorUser[];
          if (Array.isArray(arr) && arr.length) {
            setAuditores(arr.filter((u) => u.role === "auditor"));
          }
        }
      } catch (e: any) {
        if (!dead) setErr(e?.message ?? "Erro inesperado");
      } finally {
        if (!dead) setLoading(false);
      }
    }

    load();
    return () => {
      dead = true;
    };
  }, []);

  // filtro
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return auditorias.filter((a) => {
      if (statusFilter !== "todas" && String(a.status ?? "") !== statusFilter) return false;

      if (!qq) return true;

      const audLabel =
        (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
        (a.profiles?.email ?? null) ??
        (a.auditor_id ?? "—");

      const condo = (a.condominios ? `${a.condominios.nome} ${a.condominios.cidade} ${a.condominios.uf}` : "") as string;

      const bag = `${a.id} ${a.condominio_id} ${condo} ${audLabel} ${pickMonth(a)} ${a.status ?? ""}`.toLowerCase();
      return bag.includes(qq);
    });
  }, [auditorias, q, statusFilter, auditorEmailById]);

  // criação só para interno/gestor (fica no arquivo como estava, mas travado por role)
  async function criarAuditoria() {
    setErr(null);
    setOk(null);

    if (!isInterno) return setErr("Sem permissão (apenas Interno/Gestor).");

    if (!form.condominio_id) return setErr("Selecione o condomínio.");
    if (!form.ano_mes) return setErr("Selecione o mês (ano_mes).");
    if (!form.auditor_id) return setErr("Selecione o auditor (obrigatório).");

    try {
      const res = await fetch("/api/auditorias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          condominio_id: form.condominio_id,
          ano_mes: form.ano_mes,
          status: form.status,
          auditor_id: form.auditor_id || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Erro ao criar auditoria");

      setOk("Auditoria criada ✅");
      setAuditorias((prev) => [json?.auditoria as Aud, ...(prev ?? [])]);

      setForm((f) => ({ ...f, condominio_id: "", auditor_id: "" }));
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    }
  }

  async function reabrirAuditoria(id: string) {
    setErr(null);
    setOk(null);

    if (!isInterno) return setErr("Sem permissão (apenas Interno/Gestor).");

    try {
      const res = await fetch(`/api/auditorias/${id}/reabrir`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Erro ao reabrir auditoria");

      setOk("Auditoria reaberta ✅");
      setAuditorias((prev) =>
        (prev ?? []).map((a) => (a.id === id ? { ...a, status: json?.auditoria?.status ?? a.status } : a))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    }
  }

  return (
    <AppShell title="Auditorias">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Auditorias</h1>
            <div className="text-xs text-gray-500">
              {isInterno ? "Lista (interno/gestor)" : "Minhas auditorias (auditor)"}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              className="w-[320px] rounded-xl border px-3 py-2 text-sm"
              placeholder="Buscar condomínio, auditor, ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="rounded-xl border px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="todas">Todas</option>
              <option value="aberta">aberta</option>
              <option value="em_andamento">em_andamento</option>
              <option value="em_conferencia">em_conferencia</option>
              <option value="final">final</option>
            </select>
          </div>
        </div>

        {err && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
        {ok && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

        {loading ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
        ) : (
          <div className="rounded-2xl border bg-white">
            <div className="grid grid-cols-12 gap-2 border-b bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
              <div className="col-span-4">Condomínio</div>
              <div className="col-span-2">Mês</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Auditor</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {filtered.map((a) => {
              const label = condoLabel.get(a.condominio_id) ?? a.condominio_id;
              const mes = pickMonth(a) || "—";
              const audLabel =
                (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
                (a.profiles?.email ?? null) ??
                (a.auditor_id ?? "—");

              return (
                <div key={a.id} className="grid grid-cols-12 gap-2 border-b px-4 py-3 text-sm">
                  <div className="col-span-4">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-gray-500">ID: {a.id}</div>
                  </div>

                  <div className="col-span-2">{mes}</div>
                  <div className="col-span-2">{String(a.status ?? "—")}</div>
                  <div className="col-span-2">{audLabel}</div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <Link
                      className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                      href={openHref(a)}
                      title={openTitle()}
                    >
                      Abrir
                    </Link>

                    {isInterno && (
                      <button
                        className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                        onClick={() => reabrirAuditoria(a.id)}
                        title="Reabrir auditoria"
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Criar auditoria (somente interno/gestor) */}
        {isInterno && (
          <div className="mt-6 rounded-2xl border bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-gray-800">Criando auditoria</div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Condomínio</label>
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="condominio_id (uuid)"
                  value={form.condominio_id}
                  onChange={(e) => setForm((p) => ({ ...p, condominio_id: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Mês (ano_mes)</label>
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="YYYY-MM-01"
                  value={form.ano_mes}
                  onChange={(e) => setForm((p) => ({ ...p, ano_mes: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Status</label>
                <select
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value="aberta">aberta</option>
                  <option value="em_andamento">em_andamento</option>
                  <option value="em_conferencia">em_conferencia</option>
                  <option value="final">final</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Auditor (obrigatório)</label>
                <select
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  value={form.auditor_id}
                  onChange={(e) => setForm((p) => ({ ...p, auditor_id: e.target.value }))}
                >
                  <option value="">Selecione…</option>
                  {auditores.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email ?? u.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <button className="rounded-xl bg-black px-4 py-2 text-sm text-white" onClick={criarAuditoria}>
                Criar
              </button>
            </div>
          </div>
        )}

        {/* Nota */}
        {!isInterno && (
          <div className="mt-6 rounded-2xl border bg-white p-4 text-sm text-gray-700">
            <b>Obs:</b> como auditor, você só abre a auditoria na tela de campo (leituras/fotos) — ciclos são do Interno.
          </div>
        )}
      </div>
    </AppShell>
  );
}
