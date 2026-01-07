"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = { id: string; nome: string; cidade: string; uf: string };
type UserRow = { id: string; email: string; role: string };
type Aud = {
  id: string;
  condominio_id: string;
  mes_ref: string;
  status: string;
  auditor_id: string;
  condominios?: { nome: string; cidade: string; uf: string } | null;
};

type Me = { user: { id: string; email: string }; role: string };

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export default function AuditoriasPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [auditores, setAuditores] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    condominio_id: "",
    mes_ref: monthISO(),
    status: "aberta",
    auditor_id: "",
  });

  const canCreate = me?.role === "interno" || me?.role === "gestor";

  const condoLabel = useMemo(() => {
    const c = condos.find((x) => x.id === form.condominio_id);
    return c ? `${c.nome} • ${c.cidade}/${c.uf}` : "";
  }, [condos, form.condominio_id]);

  async function loadAll() {
    setErr(null);
    const [m, a, c, u] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/auditorias").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()).catch(() => null),
    ]);

    if (m?.error) {
      setErr(m.error);
      return;
    }
    setMe(m);

    if (a?.error) {
      setErr(a.error);
      return;
    }
    if (c?.error) {
      setErr(c.error);
      return;
    }

    setAuditorias(a.data || []);
    setCondos(c.data || []);

    if (u?.data && (m.role === "gestor" || m.role === "interno")) {
      setAuditores((u.data || []).filter((x: any) => x.role === "auditor"));
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function criar() {
    setErr(null);
    const r = await fetch("/api/auditorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Erro ao criar");
      return;
    }
    setForm({ ...form, condominio_id: "" });
    loadAll();
  }

  return (
    <AppShell title="Auditorias">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{auditorias.length} itens</div>
        <button className="btn" onClick={loadAll}>Recarregar</button>
      </div>

      {canCreate && (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="row">
            <div style={{ flex: 2, minWidth: 260 }}>
              <div className="small">Condomínio</div>
              <select
                className="input"
                value={form.condominio_id}
                onChange={(e) => setForm({ ...form, condominio_id: e.target.value })}
              >
                <option value="">Selecione...</option>
                {condos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} • {c.cidade}/{c.uf}
                  </option>
                ))}
              </select>
              {condoLabel && <div className="small">Selecionado: {condoLabel}</div>}
            </div>

            <div style={{ width: 180 }}>
              <div className="small">Mês ref (YYYY-MM-01)</div>
              <input className="input" value={form.mes_ref} onChange={(e) => setForm({ ...form, mes_ref: e.target.value })} />
            </div>

            <div style={{ width: 220 }}>
              <div className="small">Auditor</div>
              <select className="input" value={form.auditor_id} onChange={(e) => setForm({ ...form, auditor_id: e.target.value })}>
                <option value="">Selecione...</option>
                {auditores.map((u) => (
                  <option key={u.id} value={u.id}>{u.email}</option>
                ))}
              </select>
            </div>

            <div style={{ width: 160 }}>
              <div className="small">Status</div>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="aberta">aberta</option>
                <option value="em_campo">em_campo</option>
                <option value="em_conferencia">em_conferencia</option>
                <option value="final">final</option>
              </select>
            </div>

            <div style={{ alignSelf: "end" }}>
              <button className="btn primary" onClick={criar} disabled={!form.condominio_id || !form.mes_ref || !form.auditor_id}>
                Criar
              </button>
            </div>
          </div>
          {err && <p style={{ color: "#b42318" }}>{err}</p>}
        </div>
      )}

      {!canCreate && err && <p style={{ color: "#b42318" }}>{err}</p>}

      <hr className="hr" />

      <div className="list">
        {auditorias.map((a) => (
          <a key={a.id} className="card" href={`/auditoria/${a.id}`}>
            <div style={{ fontWeight: 700 }}>
              {a.condominios?.nome || a.condominio_id} <span className="badge">{a.status}</span>
            </div>
            <div className="small">
              {a.condominios ? `${a.condominios.cidade}/${a.condominios.uf}` : ""} • mês {a.mes_ref}
            </div>
            <div className="small">ID: {a.id}</div>
          </a>
        ))}
      </div>

      <p className="small" style={{ marginTop: 16 }}>
        Fluxo: interno cria a auditoria do mês e escolhe o auditor. Auditor preenche leituras e anexos e envia para conferência. Interno lança ciclos, anexa cashback e fecha como FINAL.
      </p>
    </AppShell>
  );
}
