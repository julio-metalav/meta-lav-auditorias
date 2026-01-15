"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Role = "auditor" | "interno" | "gestor";
type Me = { user: { id: string; email: string }; role: Role | null };

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizePath(p: string) {
  if (!p) return "/";
  const clean = p.split("?")[0].split("#")[0];
  if (clean === "") return "/";
  if (clean.startsWith("/auditor/auditoria/")) return "/auditor/auditoria";
  if (clean.includes("/condominios/") && clean.endsWith("/maquinas")) return "/condominios";
  return clean;
}

export function AppShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadMe() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!alive) return;
        if (j?.user?.id) setMe(j as Me);
      } catch {
        // ignore
      }
    }

    loadMe();
    return () => {
      alive = false;
    };
  }, []);

  async function sair() {
    await supabaseBrowser.auth.signOut();
    location.href = "/login";
  }

  const role = me?.role ?? null;

  const navItems = useMemo(() => {
    const base: { href: string; label: string; minRole: Role }[] = [
      { href: "/", label: "Início", minRole: "auditor" },
      { href: "/auditorias", label: "Auditorias", minRole: "auditor" },
    ];

    const extras: { href: string; label: string; minRole: Role }[] = [
      { href: "/condominios", label: "Pontos", minRole: "interno" },
      { href: "/atribuicoes", label: "Atribuições", minRole: "interno" },

      // Relatório financeiro mensal (interno precisa)
      { href: "/relatorios", label: "Relatórios", minRole: "interno" },

      // Usuários continua só gestor
      { href: "/usuarios", label: "Usuários", minRole: "gestor" },
    ];

    if (!role) return base;
    return [...base, ...extras].filter((x) => roleGte(role, x.minRole));
  }, [role]);

  const active = normalizePath(pathname);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <img src="/logo.png" alt="Meta Lav" className="logo" />
          <div className="meta">
            <div className="title">Meta Lav Auditorias</div>
            <div className="sub">
              Logado como <b>{me?.user?.email ?? "—"}</b> · perfil: <b>{me?.role ?? "—"}</b>
            </div>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((it) => {
            const isActive = active === normalizePath(it.href);
            return (
              <a key={it.href} className={`pill ${isActive ? "pillActive" : ""}`} href={it.href}>
                {it.label}
              </a>
            );
          })}
        </nav>

        <div className="actions">
          <button className="btn" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      {/* title é opcional: se páginas antigas passarem title, não quebra build */}
      {title ? (
        <div className="mx-auto w-full max-w-6xl px-5 pt-4">
          <div className="pageTitle">{title}</div>
        </div>
      ) : null}

      <main className="main">{children}</main>

      <style jsx>{`
        .shell {
          min-height: 100vh;
          background: #fafafa;
        }
        .top {
          display: flex;
          gap: 16px;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          background: white;
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .brand {
          display: flex;
          gap: 12px;
          align-items: center;
          min-width: 280px;
        }
        .logo {
          width: 44px;
          height: 44px;
          object-fit: contain;
        }
        .title {
          font-weight: 800;
          line-height: 1.1;
        }
        .sub {
          font-size: 12px;
          color: rgba(0, 0, 0, 0.65);
        }
        .nav {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
          flex: 1;
        }
        .actions {
          min-width: 120px;
          display: flex;
          justify-content: flex-end;
        }
        .btn {
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: white;
          padding: 8px 12px;
          border-radius: 10px;
          cursor: pointer;
        }
        .pageTitle {
          font-size: 16px;
          font-weight: 800;
          color: rgba(0, 0, 0, 0.78);
        }
        .main {
          padding: 18px;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: white;
          text-decoration: none;
          color: black;
          font-weight: 600;
          transition: transform 0.05s ease;
        }
        .pill:active {
          transform: scale(0.98);
        }
        .pill:hover {
          background: #f3f6ff;
        }
        .pillActive {
          background: #eef4ff;
          border-color: rgba(0, 0, 0, 0.18);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
