"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "auditor" | "interno" | "gestor";

type UserRow = {
  id: string;
  email: string | null;
  role: Role | null;
};

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
};

type AssignmentRow = {
  auditor_id?: string;
  condominio_id?: string;
  auditor_email?: string | null;
  condominio?: { nome: string; cidade: string; uf: string } | null;
};

function toList<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload?.data && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

function condoLabel(c: { nome: string; cidade: string; uf: string }) {
  return `${c.nome} • ${c.cidade}/${c.uf}`;
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
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

  const auditorOptions = useMemo(
    () => auditores.filter((u) => u.role === "auditor").sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    [auditores]
  );

  const condoOptions = useMemo(
    () => [...condos].sort((a, b) => condoLabel(a).localeCompare(condoLabel(b))),
    [condos]
  );

  async function carregar() {
    setLoading(true);
    setErr(null);

    try {
      const uRes = await fetch("/api/users", { cache: "no-store" });
      const uJson = await uRes.json();
      if (!uRes.ok) throw new Error(uJson?.error ?? "Falha ao carregar usuários");
      setAuditores(toList<UserRow>(uJson));

      const cRes = await fetch("/api/condominios", { cache: "no-store" });
      const cJson = await cRes.json();
      if (!cRes.ok) throw new Error(cJson?.error ?? "Falha ao carregar condomínios");
      setCondos(toList<Condo>(cJson));

      const aRes = await fetch("/api/assignments", { cache: "no-store" });
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson?.error ?? "Falha ao carregar atribuições");
      setLinks(toList<AssignmentRow>(aJson));

      setForm((f) => ({
        auditor_id: f.auditor_id || (auditorOptions[0]?.id ?? ""),
        condominio_id: f.condominio_id || (condoOptions[0]?.id ?? ""),
      }));
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function definirAuditor() {
    setErr(null);
    if (!form.auditor_id || !form.condominio_id) {
      setErr("Selecione auditor e condomínio");
      return;
    }

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao definir auditor");
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao definir auditor");
    }
  }

  function irParaAuditorias() {
    const qs = new URLSearchParams();
    qs.set("mes_ref", monthISO());
    window.location.href = `/auditorias?${qs.toString()}`;
  }

  useEffect(() => {
    carregar();
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
        Atribuições (auditor → condomínio)
      </h1>

      <div style={{ padding: 14, borderRadius: 16, border: "1px solid #e8e8e8", background: "#fbfbfb", marginBottom: 14 }}>
        <b>Importante</b>
        <div style={{ marginTop: 6, lineHeight: 1.4 }}>
          Definir auditor do condomínio <b>substitui automaticamente</b> o auditor atual
          (1 condomínio = 1 auditor padrão).<br />
          Isso <b>não cria auditoria</b>; as auditorias do mês são criadas automaticamente pelo cron (dia 25).
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={irParaAuditorias} style={{ padding: "8px 14px", borderRadius: 12, border: "1px solid #ccc" }}>
            Ir para Auditorias (ver mês)
          </button>
          <span style={{ marginLeft: 10, fontSize: 12, color: "#666" }}>
            Mês sugerido: <b>{monthISO()}</b>
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div>{links.length} vínculos</div>
        <button onClick={carregar} disabled={loading}>
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && <div style={{ color: "red", marginBottom: 10 }}>{err}</div>}

      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12 }}>
          <select value={form.auditor_id} onChange={(e) => setForm((f) => ({ ...f, auditor_id: e.target.value }))}>
            <option value="">Selecione auditor…</option>
            {auditorOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>

          <select value={form.condominio_id} onChange={(e) => setForm((f) => ({ ...f, condominio_id: e.target.value }))}>
            <option value="">Selecione condomínio…</option>
            {condoOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {condoLabel(c)}
              </option>
            ))}
          </select>

          <button onClick={definirAuditor} style={{ background: "#1f6feb", color: "white", fontWeight: 700 }}>
            Definir auditor
          </button>
        </div>
      </div>

      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 16 }}>
        {links.length === 0 ? (
          <div style={{ color: "#666" }}>Nenhuma atribuição cadastrada.</div>
        ) : (
          links.map((a, i) => (
            <div key={i} style={{ padding: 12, borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontWeight: 700 }}>{a.auditor_email ?? "-"}</div>
              <div style={{ color: "#666" }}>
                {a.condominio ? condoLabel(a.condominio) : "-"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
