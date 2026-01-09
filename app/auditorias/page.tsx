"use client";

import React, { useEffect, useMemo, useState } from "react";

type Role = "auditor" | "interno" | "gestor";

type Condo = { id: string; nome: string; cidade: string; uf: string };

type UserRow = {
  id: string;
  email: string | null;
  role: Role | null;
};

type AssignmentRow = {
  id?: string;
  auditor_id?: string;
  condominio_id?: string;

  // dependendo do join do backend:
  auditor_email?: string | null;
  email?: string | null;

  // joins possíveis:
  profiles?: { id?: string; email?: string | null; role?: Role | null } | null;
  auditor?: { id?: string; email?: string | null; role?: Role | null } | null;
};

type AuditoriaRow = {
  id: string;
  condominio_id: string;
  auditor_id?: string | null;
  ano_mes: string;
  status: string;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null } | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toList<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload?.data && Array.isArray(payload.data)) return payload.data as T[];
  if (payload?.users && Array.isArray(payload.users)) return payload.users as T[];
  if (payload?.items && Array.isArray(payload.items)) return payload.items as T[];
  return [];
}

function condoLabel(c: { nome: string; cidade: string; uf: string }) {
  return `${c.nome} • ${c.cidade}/${c.uf}`;
}

export default function AuditoriasPage() {
  const [auditorias, setAuditorias] = useState<AuditoriaRow[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [auditores, setAuditores] = useState<UserRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
    status: "aberta",
  });

  const condoOptions = useMemo(() => {
    return [...condos].sort((a, b) => condoLabel(a).localeCompare(condoLabel(b)));
  }, [condos]);

  // auditores atribuídos ao condomínio selecionado (vindo de /api/assignments)
  const auditoresAtribuidos = useMemo(() => {
    const cid = form.condominio_id;
    if (!cid) return [];

    const list = assignments
      .filter((a) => a.condominio_id === cid)
      .map((a) => {
        const id =
          a.auditor_id ??
          a.profiles?.id ??
          a.auditor?.id ??
          undefined;

        const email =
          a.auditor_email ??
          a.email ??
          a.profiles?.email ??
          a.auditor?.email ??
          null;

        return id ? { id, email, role: "auditor" as Role } : null;
      })
      .filter(Boolean) as UserRow[];

    // remove duplicados por id
    const map = new Map<string, UserRow>();
    for (const u of list) map.set(u.id, u);
    return Array.from(map.values()).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  }, [assignments, form.condominio_id]);

  async function carregarTudo() {
    setLoading(true);
    setErr(null);
    try {
      // 1) condomínios
      const cRes = await fetch("/api/condominios", { cache: "no-store" });
      const cJson = await cRes.json();
      if (!cRes.ok) throw new Error(cJson?.error ?? "Falha ao carregar condomínios");
      const cList = toList<Condo>(cJson);
      setCondos(cList);

      // 2) usuários (fallback e para mostrar emails)
      const uRes = await fetch("/api/users", { cache: "no-store" });
      const uJson = await uRes.json();
      if (!uRes.ok) throw new Error(uJson?.error ?? "Falha ao carregar usuários");
      const uList = toList<UserRow>(uJson);
      setAuditores(uList);

      // 3) atribuições (quem pode auditar qual condomínio)
      const aRes = await fetch("/api/assignments", { cache: "no-store" });
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson?.error ?? "Falha ao carregar atribuições");
      const aList = toList<AssignmentRow>(aJson);
      setAssignments(aList);

      // 4) auditorias existentes
      const auRes = await fetch("/api/auditorias", { cache: "no-store" });
      const auJson = await auRes.json();
      if (!auRes.ok) throw new Error(auJson?.error ?? "Falha ao carregar auditorias");
      const auList = toList<AuditoriaRow>(auJson);
      setAuditorias(auList);

      // defaults do form
      setForm((f) => ({
        ...f,
        condominio_id: f.condominio_id || (cList[0]?.id ?? ""),
      }));
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function criarAuditoria() {
    setErr(null);

    if (!form.condominio_id) {
      setErr("Selecione um condomínio");
      return;
    }

    // Regra: se houver auditor atribuído, tem que escolher um
    if (auditoresAtribuidos.length > 0 && !form.auditor_id) {
      setErr("Selecione um auditor (atribuído ao condomínio)");
      return;
    }

    try {
      const res = await fetch("/api/auditorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condominio_id: form.condominio_id,
          ano_mes: form.ano_mes,
          auditor_id: form.auditor_id || null,
          status: form.status,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error ?? "Falha ao criar auditoria");
        return;
      }

      await carregarTudo();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao criar auditoria");
    }
  }

  // sempre que trocar o condomínio, se só tiver 1 auditor atribuído, já seleciona
  useEffect(() => {
    if (!form.condominio_id) return;
    if (auditoresAtribuidos.length === 1) {
      setForm((f) => ({ ...f, auditor_id: auditoresAtribuidos[0].id }));
    } else {
      setForm((f) => ({ ...f, auditor_id: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.condominio_id, assignments]);

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Auditorias</h1>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#666" }}>{auditorias.length} itens</div>
        <button
          onClick={carregarTudo}
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 1fr 180px", gap: 12 }}>
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

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Mês ref (YYYY-MM-01)</div>
            <input
              value={form.ano_mes}
              onChange={(e) => setForm((f) => ({ ...f, ano_mes: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
              }}
            />
          </div>

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
              <option value="">
                {auditoresAtribuidos.length > 0
                  ? "Selecione..."
                  : "Sem atribuição (use Atribuições)"}
              </option>

              {auditoresAtribuidos.length > 0
                ? auditoresAtribuidos.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email ?? u.id}
                    </option>
                  ))
                : null}
            </select>

            {auditoresAtribuidos.length === 0 && (
              <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                Dica: vá em <b>Atribuições</b> e atribua um auditor ao condomínio.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Status</div>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
              }}
            >
              <option value="aberta">aberta</option>
              <option value="em_andamento">em_andamento</option>
              <option value="em_conferencia">em_conferencia</option>
              <option value="final">final</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            onClick={criarAuditoria}
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              border: "none",
              background: "#1f6feb",
              color: "white",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Criar
          </button>
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
        {auditorias.length === 0 ? (
          <div style={{ color: "#666" }}>Nenhuma auditoria cadastrada.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {auditorias.map((a) => {
              const c = a.condominios;
              const condLabel = c ? condoLabel(c) : a.condominio_id;
              const auditorEmail =
                a.profiles?.email ??
                auditores.find((u) => u.id === a.auditor_id)?.email ??
                a.auditor_id ??
                "-";

              return (
                <div
                  key={a.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid #f0f0f0",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{condLabel}</div>
                  <div style={{ color: "#666", marginTop: 4 }}>
                    Auditor: {auditorEmail} • mês {a.ano_mes} • <b>{a.status}</b>
                  </div>
                  <div style={{ color: "#999", marginTop: 6, fontSize: 12 }}>ID: {a.id}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, color: "#777", fontSize: 12 }}>
        Fluxo: interno cria a auditoria do mês e escolhe o auditor. Auditor preenche leituras e anexos e
        envia para conferência. Interno lança ciclos, anexa cashback e fecha como FINAL.
      </div>
    </div>
  );
}
