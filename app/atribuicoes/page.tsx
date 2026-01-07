"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = { id: string; nome: string; cidade: string; uf: string };
type UserRow = { id: string; email: string; role: string };
type AssignRow = any;

type Me = { user: { id: string; email: string }; role: string };

export default function AtribuicoesPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [auditores, setAuditores] = useState<UserRow[]>([]);
  const [assigns, setAssigns] = useState<AssignRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ auditor_id: "", condominio_id: "" });

  const can = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
    const [m, c, u, a] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()).catch(() => null),
      fetch("/api/assignments").then((r) => r.json()).catch(() => null),
    ]);

    if (m?.error) {
      setErr(m.error);
      return;
    }
    setMe(m);

    if (c?.error) {
      setErr(c.error);
      return;
    }
    setCondos(c.data || []);

    if (u?.data) {
      setAuditores((u.data || []).filter((x: any) => x.role === "auditor"));
    }

    if (a?.error) {
      setErr(a.error);
      return;
    }
    setAssigns(a?.data || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const selectedLabel = useMemo(() => {
    const au = auditores.find((x) => x.id === form.auditor_id);
    const co = condos.find((x) => x.id === form.condominio_id);
    return `${au?.email || ""} / ${co ? `${co.nome} • ${co.cidade}/${co.uf}` : ""}`;
  }, [auditores, condos, form]);

  async function atribuir() {
    setErr(null);
    const r = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Erro ao atribuir");
      return;
    }
    setForm({ auditor_id: "", condominio_id: "" });
    loadAll();
  }

  return (
    <AppShell title="Atribuições (auditor → condomínios)">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{assigns.length} vínculos</div>
        <button className="btn" onClick={loadAll}>Recarregar</button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      {can ? (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <div style={{ width: 320 }}>
              <div className="small">Auditor</div>
              <select className="input" value={form.auditor_id} onChange={(e) => setForm({ ...form, auditor_id: e.target.value })}>
                <option value="">Selecione...</option>
                {auditores.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="small">Condomínio</div>
              <select className="input" value={form.condominio_id} onChange={(e) => setForm({ ...form, condominio_id: e.target.value })}>
                <option value="">Selecione...</option>
                {condos.map((c) => <option key={c.id} value={c.id}>{c.nome} • {c.cidade}/{c.uf}</option>)}
              </select>
            </div>
            <div style={{ alignSelf: "end" }}>
              <button className="btn primary" onClick={atribuir} disabled={!form.auditor_id || !form.condominio_id}>Atribuir</button>
            </div>
          </div>
          {selectedLabel.trim() && <div className="small" style={{ marginTop: 8 }}>Selecionado: {selectedLabel}</div>}
        </div>
      ) : (
        <p className="small" style={{ marginTop: 12 }}>Só interno/gestor pode atribuir condomínios.</p>
      )}

      <hr className="hr" />

      <div className="list">
        {assigns.map((r: any, idx: number) => (
          <div key={idx} className="card">
            <div style={{ fontWeight: 700 }}>{r.profiles?.email || r.auditor_id}</div>
            <div className="small">{r.condominios?.nome || r.condominio_id} • {r.condominios ? `${r.condominios.cidade}/${r.condominios.uf}` : ""}</div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
