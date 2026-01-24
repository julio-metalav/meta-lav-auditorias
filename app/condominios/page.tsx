"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = {
  id: string;
  codigo_condominio?: string | null;
  nome: string;
  cidade?: string | null;
  uf?: string | null;
  rua?: string | null;
  numero?: string | null;
  bairro?: string | null;
  tipo_pagamento?: "direto" | "boleto" | null;

  // 🔴 NOVO
  ativo?: boolean | null;
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

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
    setOk(null);

    const [m, c] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
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
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function toggleAtivo(id: string, ativo: boolean) {
    setErr(null);
    setOk(null);

    const r = await fetch(`/api/condominios/${id}/ativo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Erro ao alterar status");
      return;
    }

    setOk(ativo ? "Condomínio ativado ✅" : "Condomínio inativado ⚠️");
    await loadAll();
  }

  return (
    <AppShell title="Pontos / Condomínios">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{condos.length} condomínios</div>
        <button className="btn" onClick={loadAll}>
          Recarregar
        </button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {ok && <p style={{ color: "#027a48" }}>{ok}</p>}

      <div className="list">
        {condos.map((c) => {
          const inativo = c.ativo === false;

          return (
            <div
              key={c.id}
              className="card"
              style={{
                opacity: inativo ? 0.45 : 1,
                filter: inativo ? "grayscale(0.3)" : "none",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {c.codigo_condominio ? `[${c.codigo_condominio}] ` : ""}
                {c.nome}
                {badgePagamento(c.tipo_pagamento)}
                {inativo && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      padding: "2px 6px",
                      borderRadius: 6,
                      background: "#fdecea",
                      color: "#b42318",
                    }}
                  >
                    INATIVO
                  </span>
                )}
              </div>

              <div className="small">
                {(c.cidade || "—")}/{(c.uf || "—")}
              </div>

              <div className="small">
                {[c.rua, c.numero, c.bairro].filter(Boolean).join(", ")}
              </div>

              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                {canEdit && (
                  <a
                    className="btn primary"
                    href={`/condominios/${c.id}`}
                    style={{ pointerEvents: inativo ? "none" : "auto" }}
                  >
                    Editar ponto
                  </a>
                )}

                <a
                  className="btn"
                  href={`/condominios/${c.id}/maquinas`}
                  style={{ pointerEvents: inativo ? "none" : "auto" }}
                >
                  Ver máquinas
                </a>

                {canEdit && (
                  <button
                    className="btn"
                    onClick={() => {
                      const acao = inativo ? "Ativar" : "Inativar";
                      if (!confirm(`${acao} o condomínio "${c.nome}"?`)) return;
                      toggleAtivo(c.id, inativo);
                    }}
                  >
                    {inativo ? "Ativar" : "Inativar"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
