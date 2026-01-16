"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor" | null;

type Me = {
  user: { id: string; email: string };
  role: Role;
};

type Counts = { condominios: number; auditorias: number };

function roleGte(role: Role, min: Exclude<Role, null>) {
  const rank: Record<Exclude<Role, null>, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function badgeClass(n: number) {
  if (n <= 0) return "bg-slate-100 text-slate-700 border-slate-200";
  if (n < 5) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-emerald-50 text-emerald-800 border-emerald-200";
}

async function fetchMe(): Promise<Me | null> {
  try {
    const r = await fetch("/api/me", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.user) return null;
    return j as Me;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<Counts>({ condominios: 0, auditorias: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;

    (async () => {
      try {
        setLoading(true);

        const m = await fetchMe();
        if (!ok) return;
        setMe(m);

        const [a, c] = await Promise.all([
          fetch("/api/auditorias", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/condominios", { cache: "no-store" }).then((r) => r.json()),
        ]);

        const auditorias = Array.isArray(a?.data) ? a.data.length : Array.isArray(a) ? a.length : 0;
        const condominios = Array.isArray(c?.data) ? c.data.length : Array.isArray(c) ? c.length : 0;

        if (ok) setCounts({ auditorias, condominios });
      } finally {
        if (ok) setLoading(false);
      }
    })();

    return () => {
      ok = false;
    };
  }, []);

  const role = me?.role ?? null;

  const cards = useMemo(() => {
    const list = [
      {
        title: "Auditorias",
        desc: "Criar, atribuir, reabrir, acompanhar status e histórico.",
        href: "/auditorias",
        minRole: "auditor" as const,
        badge: `${counts.auditorias} total`,
        badgeClass: badgeClass(counts.auditorias),
      },
      {
        title: "Pontos (condomínios)",
        desc: "Ver base e cadastrar pontos / máquinas / parâmetros.",
        href: "/condominios",
        minRole: "interno" as const,
        badge: `${counts.condominios} na base`,
        badgeClass: badgeClass(counts.condominios),
      },
      {
        title: "Atribuições",
        desc: "Atribuir auditorias e condomínios para auditores.",
        href: "/atribuicoes",
        minRole: "interno" as const,
        badge: "Gestão",
        badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
      },
      {
        title: "Relatórios",
        desc: "Relatórios operacionais e visão do mês (gestão).",
        href: "/admin/relatorios/mes-atual",
        minRole: "gestor" as const,
        badge: "Gestor",
        badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
      },
    ];

    return list.filter((c) => roleGte(role, c.minRole));
  }, [counts, role]);

  return (
    <AppShell title="Início">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          {loading
            ? "Carregando indicadores..."
            : `Base: ${counts.condominios} condomínio(s) • ${counts.auditorias} auditoria(s)`}
        </div>

        <button
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{c.title}</div>
                <div className="mt-1 text-sm text-slate-600">{c.desc}</div>
              </div>

              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${c.badgeClass}`}>
                {c.badge}
              </span>
            </div>

            <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-900">
              Abrir <span className="transition group-hover:translate-x-0.5">→</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold">Próximo passo do MVP</div>
        <div className="mt-1 text-sm text-slate-600">
          Interno fecha a auditoria com ciclos por máquina + comprovante de cashback/repasse. Depois: relatório simples
          (visualização) + PDF.
        </div>
      </div>
    </AppShell>
  );
}
