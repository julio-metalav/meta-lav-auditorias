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
  // remove trailing slash (exceto "/")
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathnameRaw = usePathname() ?? "/";
  const pathname = normalizePath(pathnameRaw);

  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  async function loadMe() {
    setMeLoading(true);
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok && j) setMe(j);
    } catch {
      // silencioso
    } finally {
      setMeLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function sair() {
    await supabaseBrowser.auth.signOut();
    location.href = "/login";
  }

  const role = me?.role ?? null;

  const navItems = useMemo(() => {
    // SEMPRE mostra o básico, mesmo sem /api/me
    const base: { href: string; label: string; minRole: Role }[] = [
      { href: "/", label: "Início", minRole: "auditor" },
      { href: "/auditorias", label: "Auditorias", minRole: "auditor" },
    ];

    // Itens extras só quando já sabemos o role
    const extras: { href: string; label: string; minRole: Role }[] = [
      { href: "/condominios", label: "Pontos", minRole: "interno" },
      { href: "/atribuicoes", label: "Atribuições", minRole: "interno" },
      { href: "/relatorios", label: "Relatórios", minRole: "gestor" },
      { href: "/usuarios", label: "Usuários", minRole: "gestor" },
    ];

    if (!role) return base;

    return [...base, ...extras.filter((it) => roleGte(role, it.minRole))];
  }, [role]);

  function isActive(href: string) {
    const h = normalizePath(href);
    if (h === "/") return pathname === "/";
    return pathname === h || pathname.startsWith(h + "/");
  }

  return (
    <div className="card">
      <div className="topbar">
        <div className="brand">
          <img src="/logo.jpg" alt="Meta Lav" className="logo" />
          <div>
            <div className="brandTitle">Meta Lav Auditorias</div>
            <div className="small">
              {me?.user?.email ? (
                <>
                  <span>Logado como </span>
                  <b>{me.user.email}</b>
                  <span> • perfil: </span>
                  <b>{me.role ?? "—"}</b>
                </>
              ) : meLoading ? (
                "Carregando perfil..."
              ) : (
                "Sessão ativa"
              )}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={sair}>
            Sair
          </button>
        </div>
      </div>

      {/* NAV mobile-first: pílulas com scroll */}
      <div className="navWrap">
        <nav className="navPills" aria-label="Navegação">
          {navItems.map((it) => {
            const active = isActive(it.href);
            return (
              <a key={it.href} className={`pill ${active ? "pillActive" : ""}`} href={it.href} aria-current={active ? "page" : undefined}>
                {it.label}
              </a>
            );
          })}
        </nav>
      </div>

      <h1 className="title" style={{ marginTop: 14 }}>
        {title}
      </h1>

      {children}

      <style jsx>{`
        .navWrap {
          margin-top: 10px;
        }
        .navPills {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding: 6px 2px;
          scrollbar-width: none;
        }
        .navPills::-webkit-scrollbar {
          display: none;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: #fbfcff;
          text-decoration: none;
          color: inherit;
          font-size: 14px;
          line-height: 1;
          transition: transform 0.05s ease, background 0.15s ease, border-color 0.15s ease;
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
