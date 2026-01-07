"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type UserRow = { id: string; email: string; role: string; created_at?: string };

type Me = { user: { id: string; email: string }; role: string };

export default function UsuariosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", password: "", role: "auditor" });

  const canManage = me?.role === "gestor";

  async function load() {
    setErr(null);
    const [m, u] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()).catch(() => null),
    ]);
    if (m?.error) {
      setErr(m.error);
      return;
    }
    setMe(m);
    if (u?.error) {
      setErr(u.error);
      return;
    }
    setRows(u?.data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function criar() {
    setErr(null);
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Erro ao criar");
      return;
    }
    setForm({ email: "", password: "", role: "auditor" });
    load();
  }

  return (
    <AppShell title="Usuários">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{rows.length} usuários</div>
        <button className="btn" onClick={load}>Recarregar</button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      {canManage ? (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="small">Criar usuário (login e senha)</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <div className="small">Email</div>
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <div className="small">Senha</div>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <div className="small">Role</div>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="auditor">auditor</option>
                <option value="interno">interno</option>
                <option value="gestor">gestor</option>
              </select>
            </div>
            <div style={{ alignSelf: "end" }}>
              <button className="btn primary" onClick={criar} disabled={!form.email || !form.password}>Criar</button>
            </div>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            Para funcionar, você precisa do <b>SUPABASE_SERVICE_ROLE_KEY</b> no .env.local.
          </p>
        </div>
      ) : (
        <p className="small" style={{ marginTop: 12 }}>Só o gestor pode criar usuários.</p>
      )}

      <hr className="hr" />

      <div className="list">
        {rows.map((u) => (
          <div key={u.id} className="card">
            <div style={{ fontWeight: 700 }}>{u.email}</div>
            <div className="small">role: {u.role}</div>
            <div className="small">id: {u.id}</div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
