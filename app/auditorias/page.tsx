"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

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

type AuditorUser = { id: string; email?: string | null; role?: Role | null };

type Me = { user: { id: string; email: string }; role: Role | null };

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

function normStatus(s: any) {
  const x = String(s ?? "").trim().toLowerCase();
  if (x === "em conferencia") return "em_conferencia";
  return x;
}

function statusLabel(s: any) {
  const x = normStatus(s);
  if (x === "aberta") return "aberta";
  if (x === "em_andamento") return "em_andamento";
  if (x === "em_conferencia") return "em_conferencia";
  if (x === "final") return "final";
  return String(s ?? "-");
}

// ✅ aceita array puro OU {data:[...]} OU {auditorias:[...]} OU {rows:[...]}
function extractArray<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(payload?.data)) return payload.data as T[];
  if (Array.isArray(payload?.auditorias)) return payload.auditorias as T[];
  if (Array.isArray(payload?.rows)) return payload.rows as T[];
  return [];
}

export default function AuditoriasPage() {
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [auditores, setAuditores] = useState<AuditorUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "todas" | "a_fazer" | "concluidas" | "aberta" | "em_andamento" | "em_conferencia" | "final"
  >("todas");

  const isAuditor = (me?.role ?? null) === "auditor";

  useEffect(() => {
    if (isAuditor) setStatusFilter("a_fazer");
    else setStatusFilter("todas");
  }, [isAuditor]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setErr(null);

      try {
        const [meRes, aRes, uRes] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/auditorias", { cache: "no-store" }),
          fetch("/api/users", { cache: "no-store" }),
        ]);

        const meJson = await meRes.json().catch(() => ({}));
        if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário");

        const aJson = await aRes.json().catch(() => ({}));
        if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar auditorias");

        const uJson = await uRes.json().catch(() => ({}));
        const users = uRes.ok ? extractArray<AuditorUser>(uJson) : [];

        const meObj: Me =
          meJson?.user && typeof meJson?.role !== "undefined"
            ? (meJson as Me)
            : ({ user: meJson, role: (meJson?.role ?? null) as any } as any);

        const auds = extractArray<Aud>(aJson);

        if (!alive) return;

        setMe(meObj);
        setAuditorias(auds);
        setAuditores(users.filter((u) => u.role === "auditor"));
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Falha ao carregar");
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const auditorEmailById = useMemo(() => {
    const m = new Map<string, string>();
    auditores.forEach((u) => m.set(u.id, u.email ?? u.id));
    return m;
  }, [auditores]);

  const condoLabelByCondoId = useMemo(() => {
    const m = new Map<string, string>();
    auditorias.forEach((a) => {
      const c = a.condominios;
      if (a.condominio_id && c?.nome) {
        m.set(a.condominio_id, `${c.nome} - ${c.cidade}/${c.uf}`);
      }
    });
    return m;
  }, [auditorias]);

  const statusOptions = useMemo(() => {
    if (isAuditor) {
      return [
        { value: "a_fazer", label: "A fazer" },
        { value: "concluidas", label: "Concluídas" },
        { value: "todas", label: "Todas" },
      ] as const;
    }
    return [
      { value: "todas", label: "Todas" },
      { value: "aberta", label: "aberta" },
      { value: "em_andamento", label: "em_andamento" },
      { value: "em_conferencia", label: "em_conferencia" },
      { value: "final", label: "final" },
    ] as const;
  }, [isAuditor]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();

    const filtered = auditorias.filter((a) => {
      const s = normStatus(a.status);

      if (isAuditor) {
        if (statusFilter === "a_fazer") {
          if (!(s === "aberta" || s === "em_andamento")) return false;
        } else if (statusFilter === "concluidas") {
          if (!(s === "em_conferencia" || s === "final")) return false;
        } else if (statusFilter !== "todas") {
          if (s !== statusFilter) return false;
        }
      } else {
        if (statusFilter !== "todas" && s !== statusFilter) return false;
      }

      if (!term) return true;

      const condo =
        a.condominios?.nome
          ? `${a.condominios.nome} - ${a.condominios.cidade}/${a.condominios.uf}`
          : condoLabelByCondoId.get(a.condominio_id) ?? "";

      const audLabel =
        (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
        (a.profiles?.email ?? null) ??
        (a.auditor_id ?? "—");

      const hay = [a.id, a.condominio_id, condo, pickMonth(a), statusLabel(a.status), audLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(term);
    });

    filtered.sort((a, b) => {
      const am = pickMonth(a);
      const bm = pickMonth(b);
      if (am === bm) return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      return bm.localeCompare(am);
    });

    return filtered;
  }, [auditorias, q, statusFilter, isAuditor, condoLabelByCondoId, auditorEmailById]);

  return (
    <AppShell title="Auditorias">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Auditorias</h1>
            <div className="text-xs text-gray-500">{isAuditor ? "Minhas auditorias (auditor)" : "Lista (interno/gestor)"}</div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="w-full rounded-xl border px-4 py-2 text-sm sm:w-[360px]"
              placeholder="Buscar condomínio, auditor, ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="rounded-xl border px-4 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              title="Filtro de status"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        <div className="mb-3 text-xs text-gray-500">
          Debug: carregadas <b>{auditorias.length}</b> auditorias • no filtro <b>{list.length}</b>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2">Mês</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Auditor</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>

          {list.length === 0 && <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>}

          <div className="divide-y">
            {list.map((a) => {
              const condo =
                a.condominios?.nome
                  ? `${a.condominios.nome} - ${a.condominios.cidade}/${a.condominios.uf}`
                  : condoLabelByCondoId.get(a.condominio_id) ?? a.condominio_id;

              const audLabel =
                (a.auditor_id ? auditorEmailById.get(a.auditor_id) : null) ??
                (a.profiles?.email ?? null) ??
                (a.auditor_id ?? "—");

              return (
                <div key={a.id} className="grid grid-cols-12 items-center px-4 py-4 text-sm">
                  <div className="col-span-5">
                    <div className="font-semibold">{condo}</div>
                    <div className="text-xs text-gray-500">ID: {a.id}</div>
                  </div>

                  <div className="col-span-2 font-mono text-xs text-gray-700">{pickMonth(a)}</div>
                  <div className="col-span-2 font-mono text-xs text-gray-700">{statusLabel(a.status)}</div>
                  <div className="col-span-2 text-gray-700">{audLabel}</div>

                  <div className="col-span-1 text-right">
                    <a
                      className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                      href={isAuditor ? `/auditor/auditoria/${a.id}` : `/interno/auditoria/${a.id}`}
                      title="Abrir"
                    >
                      Abrir
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {isAuditor && (
          <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-600">
            <b>Obs:</b> como auditor, você só abre a auditoria na tela de campo (leituras/fotos) — ciclos são do Interno.
            <div className="mt-1 text-xs text-gray-500">
              Regra operacional: ao concluir em campo, a auditoria sai de “A fazer” e vai para “Concluídas”.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
