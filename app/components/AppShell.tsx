"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Me = { user: { id: string; email: string }; role: string };

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);

  async function loadMe() {
    const r = await fetch("/api/me");
    const j = await r.json().catch(() => null);
    if (r.ok) setMe(j);
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function sair() {
    await supabaseBrowser.auth.signOut();
    location.href = "/login";
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
                <>Logado como <b>{me.user.email}</b> • role: <b>{me.role}</b></>
              ) : (
                "Carregando..."
              )}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={sair}>Sair</button>
        </div>
      </div>

      <div className="nav">
        <a className="tab" href="/">Dashboard</a>
        <a className="tab" href="/condominios">Cadastro do ponto</a>
        <a className="tab" href="/auditorias">Auditorias</a>
        <a className="tab" href="/relatorios">Relatório/PDF</a>
        <a className="tab" href="/usuarios">Usuários</a>
        <a className="tab" href="/atribuicoes">Atribuições</a>
      </div>

      <h1 className="title" style={{ marginTop: 16 }}>{title}</h1>
      {children}
    </div>
  );
}
