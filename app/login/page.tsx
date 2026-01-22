"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function entrar() {
    setErr(null);
    setLoading(true);

    const { data, error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      setLoading(false);
      setErr(error.message);
      return;
    }

    const access_token = data?.session?.access_token ?? "";
    const refresh_token = data?.session?.refresh_token ?? "";

    try {
      // grava cookies httpOnly no servidor (pra middleware enxergar)
      const r = await fetch("/api/auth/set-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token, refresh_token }),
      });

      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? "Falha ao setar sessão");

      const next = new URLSearchParams(location.search).get("next") || "/";
      location.href = next;
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao finalizar login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        {/* ✅ logo correta (coloque /public/logo-meta-lav.jpg) */}
        <img
          src="/logo-meta-lav.jpg"
          alt="Meta Lav"
          className="logo"
          style={{ height: 42, width: "auto", objectFit: "contain" }}
        />
        <div>
          <h1 className="title" style={{ margin: 0 }}>
            Meta Lav Auditorias
          </h1>
          <div className="small">Login por usuário (Supabase)</div>
        </div>
      </div>

      <hr className="hr" />

      <div className="grid2">
        <div>
          <div className="small">Email</div>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
        </div>
        <div>
          <div className="small">Senha</div>
          <input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
        </div>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={entrar} disabled={!email || !senha || loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>

      <p className="small" style={{ marginTop: 12 }}>
        Se você ainda não tem usuário, peça para o gestor criar em <b>Usuários</b>.
      </p>
    </div>
  );
}
