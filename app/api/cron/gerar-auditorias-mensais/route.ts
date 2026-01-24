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
