"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  rua?: string;
  numero?: string;
  bairro?: string;

  tipo_pagamento?: "direto" | "boleto" | null;
  codigo_condominio?: string | null;

  // ✅ NOVO
  ativo?: boolean;
};

type Me = { user: { id: string; email: string }; role: string };

function badgePagamento(tipo?: string | null) {
  const t = String(tipo ?? "direto").toLowerCase();
  const label = t === "boleto" ? "Boleto" : "Direto";
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #d0d5dd",
        background: "#f9fafb",
      }}
    >
      {label}
    </span>
  );
}

export default function CondominiosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
    setOk(null);

    const [m, c] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
    ]);

    if (m?.error) return setErr(m.error);
    if (c?.error) return setErr(c.error);

    setMe(m);
    setCondos(c.data || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // ✅ AQUI ESTÁ A FUNÇÃO QUE FALTAVA
  async function toggleAtivo(c: Condo) {
    if (!canEdit) return;

    const confirmMsg = c.ativo
      ? `Inativar o condomínio "${c.nome}"?`
      : `Ativar o condomínio "${c.nome}"?`;

    if (!confirm(confirmMsg)) return;

    try {
      setSaving(true);
      setErr(null);
      setOk(null);

      const r = await fetch(`/api/condominios/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !c.ativo }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Erro ao atualizar status");

      setOk("Status atualizado com sucesso");
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || "Erro ao atualizar condomínio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Cadastro do ponto">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{condos.length} condomínios</div>
        <button className="btn" onClick={loadAll}>
          Recarregar
        </button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {ok && <p style={{ color: "#027a48" }}>{ok}</p>}

      <hr className="hr" />

      <div className="list">
        {condos.map((c) => (
          <div key={c.id} className="card">
            <div style={{ fontWeight: 700 }}>
              {c.codigo_condominio ? `[${c.codigo_condominio}] ` : ""}
              {c.nome}
              {badgePagamento(c.tipo_pagamento)}
            </div>

            <div className="small">
              {(c.cidade || "—")}/{(c.uf || "—")}
            </div>

            <div className="small">
              {[c.rua, c.numero, c.bairro].filter(Boolean).join(", ")}
            </div>

            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              {canEdit && (
                <a className="btn primary" href={`/condominios/${c.id}`}>
                  Editar ponto
                </a>
              )}

              <a className="btn" href={`/condominios/${c.id}/maquinas`}>
                Ver máquinas
              </a>

              {canEdit && (
                <button
                  className="btn"
                  disabled={saving}
                  onClick={() => toggleAtivo(c)}
                >
                  {c.ativo === false ? "Ativar" : "Inativar"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
