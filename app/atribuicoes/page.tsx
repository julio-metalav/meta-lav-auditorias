"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "auditor" | "interno" | "gestor";

type UserRow = {
  id: string;
  email: string | null;
  role: Role | null;
  created_at?: string | null;
};

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
};

type AssignmentRow = {
  id?: string;
  auditor_id?: string;
  condominio_id?: string;

  // formatos que podem vir do backend:
  auditor_email?: string | null;
  email?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  condominio?: { nome: string; cidade: string; uf: string } | null;

  condominios_nome?: string | null;
  condominios_cidade?: string | null;
  condominios_uf?: string | null;
  condominio_nome?: string | null;
  condominio_cidade?: string | null;
  condominio_uf?: string | null;
};

function toList<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload?.users && Array.isArray(payload.users)) return payload.users as T[];
  if (payload?.data && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

function condoLabel(c: { nome: string; cidade: string; uf: string }) {
  return `${c.nome} • ${c.cidade}/${c.uf}`;
}

function pickCondoFromAssignment(a: AssignmentRow) {
  const c =
    a.condominios ??
    a.condominio ??
    (a.condominio_nome || a.condominios_nome
      ? {
          nome: (a.condominio_nome ?? a.condominios_nome) as string,
          cidade: (a.condominio_cidade ?? a.condominios_cidade) as string,
          uf: (a.condominio_uf ?? a.condominios_uf) as string,
        }
      : null);

  return c;
}

export default function AtribuicoesPage() {
  const [auditores, setAuditores] = useState<UserRow[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [links, setLinks] = useState<AssignmentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<{ auditor_id: string; condominio_id: string }>({
    auditor_id: "",
    condominio_id: "",
  });

  const auditorOptions = useMemo(() => {
    return auditores
      .filter((u) => u.role === "auditor")
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  }, [auditores]);

  const condoOptions = useMemo(() => {
    return [...condos].sort((a, b) => condoLabel(a).localeCompare(condoLabel(b)));
  }, [condos]);

  async function carregar() {
    setLoading(true);
    setErr(null);

    try {
      // 1) usuários (para popular o select de auditores)
      const uRes = await fetch("/api/users", { cache: "no-store" });
      const uJson = await uRes.json();
      if (!uRes.ok) throw new Error(uJson?.error ?? "Falha ao carregar usuários");
      const uList = toList<UserRow>(uJson);
      setAuditores(uList);

      // 2) condomínios (para popular o select)
      const cRes = await fetch("/api/condominios", { cache: "no-store" });
      const cJson = await cRes.json();
      if (!cRes.ok) throw new Error(cJson?.error ?? "Falha ao carregar condomínios");
      const cList = toList<Condo>(cJson);
      setCondos(cList);

      // 3) vínculos existentes
      const aRes = await fetch("/api/assignments", { cache: "no-store" });
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson?.error ?? "Falha ao carregar atribuições");
      const aList = toList<AssignmentRow>(aJson);
      setLinks(aList);

      // default do form (se estiver vazio)
      setForm((f) => ({
        auditor_id: f.auditor_id || (uList.find((x) => x.role === "auditor")?.id ?? ""),
        condominio_id: f.condominio_id || (cList[0]?.id ?? ""),
      }));
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function atribuir() {
    setErr(null);

    if (!form.auditor_id || !form.condominio_id) {
      setErr("Selecione auditor e condomínio");
      return;
    }

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditor_id: form.auditor_id,
          condominio_id: form.condominio_id,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error ?? "Falha ao atribuir");
        return;
      }

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao atribuir");
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
        Atribuições (auditor → condomínios)
      </h1>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#666" }}>{links.length} vínculos</div>
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

      {err ? <div style={{ marginTop: 12, color: "#c00" }}>{err}</div> : <div style={{ marginTop: 12 }} />}

      <div
        style={{
          marginTop: 18,
          padding: 18,
          border: "1px solid #e6e6e6",
          borderRadius: 16,
          background: "white",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Auditor</div>
            <select
              value={form.auditor_id}
              onChange={(e) => setForm((f) => ({ ...f, auditor_id: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
              }}
            >
              <option value="">Selecione...</option>
              {auditorOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email ?? u.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Condomínio</div>
            <select
              value={form.condominio_id}
              onChange={(e) => setForm((f) => ({ ...f, condominio_id: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
              }}
            >
              <option value="">Selecione...</option>
              {condoOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {condoLabel(c)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              onClick={atribuir}
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
              Atribuir
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
        {links.length === 0 ? (
          <div style={{ color: "#666" }}>Nenhuma atribuição cadastrada.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {links.map((a, idx) => {
              const email = a.auditor_email ?? a.email ?? "-";
              const c = pickCondoFromAssignment(a);
              return (
                <div
                  key={(a.id as string) ?? `${email}-${idx}`}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid #f0f0f0",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{email}</div>
                  <div style={{ color: "#666", marginTop: 4 }}>
                    {c ? condoLabel(c) : "-"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
