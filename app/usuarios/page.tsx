"use client";

import { useEffect, useState } from "react";

type Role = "auditor" | "interno" | "gestor";
type UserRow = {
  id: string;
  email: string | null;
  role: Role | null;
  created_at?: string | null;
};

function toList(payload: any): UserRow[] {
  // Aceita tanto array direto (nosso caso) quanto formatos antigos {users:[]}/{data:[]}
  if (Array.isArray(payload)) return payload as UserRow[];
  if (payload?.users && Array.isArray(payload.users)) return payload.users as UserRow[];
  if (payload?.data && Array.isArray(payload.data)) return payload.data as UserRow[];
  return [];
}

export default function UsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<{ email: string; senha: string; role: Role }>({
    email: "",
    senha: "",
    role: "auditor",
  });

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const json = await res.json();

      if (!res.ok) {
        setUsers([]);
        setErr(json?.error ?? "Falha ao carregar usuários");
        return;
      }

      const list = toList(json);
      setUsers(list);
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao carregar");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  async function criar() {
    setErr(null);

    const email = form.email.trim().toLowerCase();
    const senha = String(form.senha ?? "");

    if (!email || !senha) {
      setErr("Email e senha são obrigatórios");
      return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha, role: form.role }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error ?? "Falha ao criar usuário");
        return;
      }

      setForm((f) => ({ ...f, email: "", senha: "" }));
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao criar usuário");
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Usuários</h1>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#666" }}>{users.length} usuários</div>
        <button
          onClick={carregar}
          style={{
            padding: "10px 16px",
            borderRadius: 14,
            border: "1px solid #d8d8d8",
            background: "white",
            cursor: "pointer",
          }}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err ? (
        <div style={{ marginTop: 12, color: "#c00" }}>{err}</div>
      ) : (
        <div style={{ marginTop: 12 }} />
      )}

      <div
        style={{
          marginTop: 18,
          padding: 18,
          border: "1px solid #e6e6e6",
          borderRadius: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Criar usuário (login e senha)</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Email</div>
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
              }}
              placeholder="email@exemplo.com"
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Senha</div>
            <input
              type="password"
              value={form.senha}
              onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
              }}
              placeholder="********"
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Role</div>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
              }}
            >
              <option value="auditor">auditor</option>
              <option value="interno">interno</option>
              <option value="gestor">gestor</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              onClick={criar}
              style={{
                padding: "12px 18px",
                borderRadius: 14,
                border: "none",
                background: "#1f6feb",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Criar
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 18,
          border: "1px solid #e6e6e6",
          borderRadius: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Lista</div>

        {users.length === 0 ? (
          <div style={{ color: "#666" }}>Nenhum usuário listado.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Email</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Role</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>
                    Criado em
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f3f3f3" }}>
                      {u.email ?? "-"}
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f3f3f3" }}>
                      {u.role ?? "-"}
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f3f3f3" }}>
                      {u.created_at ? new Date(u.created_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
