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
    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password: senha,
    });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const next = new URLSearchParams(location.search).get("next") || "/";
    location.href = next;
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <img src="/logo.jpg" alt="Meta Lav" className="logo" />
        <div>
          <h1 className="title" style={{ margin: 0 }}>Meta Lav Auditorias</h1>
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
