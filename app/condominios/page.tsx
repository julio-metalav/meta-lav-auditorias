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
      {t === "boleto" ? "Boleto" : "Direto"}
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

    if (m?.error) return setErr(m.error);
    if (c?.error) return setErr(c.error);

    setMe(m);
    setCondos(c.data || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function toggleAtivo(c: Condo) {
    try {
      setErr(null);
      setOk(null);

      const r = await fetch(`/api/condominios/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !c.ativo }),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erro ao atualizar status");

      setOk(`Condomínio ${!c.ativo ? "ativado" : "inativado"} com sucesso`);
      await loadAll();
    } catch (e: any) {
      setErr(e.message || "Erro");
    }
  }

  return (
    <AppShell title="Cadastro do ponto">
      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {ok && <p style={{ color: "#027a48" }}>{ok}</p>}

      <div className="list">
        {condos.map((c) => {
          const ativo = c.ativo !== false;

          return (
            <div
              key={c.id}
              className="card"
              style={{
                opacity: ativo ? 1 : 0.45,
                filter: ativo ? "none" : "grayscale(40%)",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {c.codigo_condominio ? `[${c.codigo_condominio}] ` : ""}
                {c.nome}
                {badgePagamento(c.tipo_pagamento)}
                {!ativo && (
                  <span style={{ marginLeft: 8, color: "#b42318", fontSize: 12 }}>
                    (INATIVO)
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
                {canEdit && ativo && (
                  <a className="btn primary" href={`/condominios/${c.id}`}>
                    Editar ponto
                  </a>
                )}

                {ativo && (
                  <a className="btn" href={`/condominios/${c.id}/maquinas`}>
                    Ver máquinas
                  </a>
                )}

                {canEdit && (
                  <button
                    className="btn"
                    onClick={() => toggleAtivo(c)}
                  >
                    {ativo ? "Inativar" : "Ativar"}
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
