"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Role = "auditor" | "interno" | "gestor" | null;

type Me = {
  user: { id: string; email: string };
  role: Role;
};

type NavItem = {
  href: string;
  label: string;
  minRole?: Exclude<Role, null>;
};

function roleGte(role: Role, min: Exclude<Role, null>) {
  const rank: Record<Exclude<Role, null>, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
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

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function AppShell({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  useEffect(() => {
    let ok = true;
    (async () => {
      setLoadingMe(true);
      const m = await fetchMe();
      if (ok) {
        setMe(m);
        setLoadingMe(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const navAll: NavItem[] = useMemo(
    () => [
      { href: "/", label: "Início", minRole: "auditor" },
      { href: "/auditorias", label: "Auditorias", minRole: "auditor" },
      { href: "/condominios", label: "Pontos", minRole: "interno" },
      { href: "/atribuicoes", label: "Atribuições", minRole: "interno" },

      // Gestor
      { href: "/usuarios", label: "Usuários", minRole: "gestor" },
      { href: "/admin/relatorios/mes-atual", label: "Relatórios", minRole: "gestor" },
    ],
    []
  );

  const nav = useMemo(() => {
    const role = me?.role ?? null;
    return navAll.filter((it) => !it.minRole || roleGte(role, it.minRole));
  }, [navAll, me?.role]);

  async function onLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    router.push("/login");
  }

  const showBack = pathname !== "/";

  function handleBack() {
    try {
      const sp = new URLSearchParams(window.location.search);
      const back = sp.get("back");
      if (back) {
        router.push(back);
        return;
      }
    } catch {}

    router.back();

    // fallback: se não houver histórico (aba nova)
    setTimeout(() => {
      if (window.history.length <= 1) {
        router.push("/auditorias");
      }
    }, 50);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <header className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-16 items-center justify-between gap-3">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <img
                src="/logo.jpg"
                alt="Meta-Lav"
                className="h-8 w-auto"
                style={{ display: "block" }}
              />
              <div className="leading-tight">
                <div className="text-sm font-semibold">Meta Lav Auditorias</div>
                <div className="text-[12px] text-slate-500">
                  {loadingMe
                    ? "Carregando..."
                    : me?.user?.email
                    ? `Logado como ${me.user.email}${me.role ? ` • perfil: ${me.role}` : ""}`
                    : "Não autenticado"}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {showBack && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  title="Voltar"
                >
                  Voltar
                </button>
              )}
              <button
                type="button"
                onClick={onLogout}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                title="Sair"
              >
                Sair
              </button>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex flex-wrap items-center gap-2 pb-3">
            {nav.map((it) => {
              const active =
                pathname === it.href ||
                (it.href !== "/" && pathname?.startsWith(it.href));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={classNames(
                    "rounded-full px-4 py-2 text-sm font-medium transition",
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {title ? <h1 className="mb-4 text-2xl font-semibold">{title}</h1> : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-slate-500">
          Meta-Lav • Auditorias • {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
