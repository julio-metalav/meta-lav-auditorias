"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type TipoPagamento = "direto" | "boleto";

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  tipo_pagamento?: TipoPagamento | null;
};

type Me = { user: { id: string; email: string }; role: string };

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

export default function CondominiosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement | null>(null);

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
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

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell title="Condomínios">
      {/* TOPO */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{condos.length} condomínios</div>

        <div className="row" style={{ gap: 8 }}>
          {canEdit && (
            <button className="btn primary" onClick={scrollToForm}>
              + Novo condomínio
            </button>
          )}
          <button className="btn" onClick={loadAll}>
            Recarregar
          </button>
        </div>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      {/* LISTA */}
      <div className="list">
        {condos.map((c) => {
          const tp = normalizeTipoPagamento(c.tipo_pagamento);
          return (
            <div key={c.id} className="card">
              <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{c.nome}</span>
                <span
                  className="small"
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid #e5e7eb",
                    background: tp === "boleto" ? "#fff7ed" : "#f0fdf4",
                  }}
                >
                  {tp === "boleto" ? "Boleto" : "Direto"}
                </span>
              </div>

              <div className="small">
                {c.cidade}/{c.uf}
              </div>
              <div className="small">{[c.rua, c.numero, c.bairro].filter(Boolean).join(", ")}</div>

              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <a className="btn" href={`/condominios/${c.id}/maquinas`}>
                  Ver máquinas
                </a>
                {canEdit && (
                  <a className="btn" href={`/condominios/${c.id}`}>
                    Editar
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FORMULÁRIO (âncora) */}
      <div ref={formRef} />
      {/* ⚠️ o formulário de cadastro que você já tem continua abaixo, SEM ALTERAÇÃO */}
    </AppShell>
  );
}
