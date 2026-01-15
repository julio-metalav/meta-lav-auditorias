"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type TipoPagamento = "direto" | "boleto";

type Row = {
  mes_ref: string | null;

  condominio_id: string;
  condominio_nome: string | null;
  cidade: string | null;
  uf: string | null;

  valor_total_pagar: number | null;
  valor_cashback: number | null;
  valor_repasse_utilidades: number | null;

  pct_valor_total_pagar?: number | null;
  pct_valor_cashback?: number | null;
  pct_valor_repasse_utilidades?: number | null;

  banco_pix: string | null;
  banco_nome: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;

  // NOVO (se vier do backend)
  tipo_pagamento?: TipoPagamento | null;

  status: string | null;
  auditoria_id: string | null;
};

type Totals = {
  now: {
    valor_cashback: number;
    valor_repasse_utilidades: number;
    valor_total_pagar: number;
  };
  pct: {
    valor_cashback: number | null;
    valor_repasse_utilidades: number | null;
    valor_total_pagar: number | null;
  };
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function addMonths(iso: string, delta: number) {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  return monthISO(d);
}

function labelMes(iso: string) {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[m - 1]}/${y}`;
}

function money(v: any) {
  return Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function pctBadge(v?: number | null) {
  if (v === null || v === undefined) return <span className="text-xs text-gray-400">—</span>;
  const pos = v >= 0;
  return (
    <span className={`ml-2 text-xs font-semibold ${pos ? "text-green-600" : "text-red-600"}`}>
      {pos ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Erro");
  return json;
}

function normalizeTipoPagamento(v: any): TipoPagamento | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  return s === "boleto" ? "boleto" : "direto";
}

function renderPagamento(r: Row) {
  const tp = normalizeTipoPagamento((r as any).tipo_pagamento);

  // Se o backend ainda não manda tipo_pagamento, mantém o comportamento antigo
  if (!tp) {
    return <span className="text-xs text-gray-500">{r.banco_pix ? "PIX" : r.banco_nome ?? "—"}</span>;
  }

  if (tp === "boleto") {
    return <span className="text-xs font-semibold">Pagamento via boleto</span>;
  }

  // direto: mostrar dados bancários / PIX
  if (r.banco_pix) {
    return (
      <div className="text-xs">
        <div className="font-semibold">PIX</div>
        <div className="text-gray-500 truncate" title={r.banco_pix}>
          {r.banco_pix}
        </div>
      </div>
    );
  }

  const banco = r.banco_nome ?? "Banco";
  const ag = r.banco_agencia ? `Ag ${r.banco_agencia}` : "";
  const cc = r.banco_conta ? `C/C ${r.banco_conta}` : "";

  return (
    <div className="text-xs">
      <div className="font-semibold">{banco}</div>
      <div className="text-gray-500">
        {[ag, cc].filter(Boolean).join(" • ") || "—"}
      </div>
    </div>
  );
}

export default function RelatoriosPage() {
  const [mes, setMes] = useState(() => monthISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function carregar(m: string) {
    try {
      setErr(null);
      const json = await fetchJSON(`/api/financeiro/relatorio?mes=${m}`);
      setRows(json.rows ?? []);
      setTotals(json.totals ?? null);
    } catch (e: any) {
      setErr(e.message);
      setRows([]);
    }
  }

  useEffect(() => {
    carregar(mes);
  }, [mes]);

  return (
    <AppShell title="Relatórios (Financeiro)">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold">Relatório Financeiro</h1>
            <p className="text-xs text-gray-500">
              Mês: <b>{labelMes(mes)}</b> • referência: mês anterior
            </p>
          </div>

          <div className="flex gap-2">
            <button className="btn" onClick={() => setMes(addMonths(mes, -1))}>
              ← {labelMes(addMonths(mes, -1))}
            </button>
            <button className="btn" onClick={() => carregar(mes)}>
              Recarregar
            </button>
            <button className="btn" onClick={() => setMes(addMonths(mes, 1))}>
              {labelMes(addMonths(mes, 1))} →
            </button>
          </div>
        </div>

        {err && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        {/* Cards */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="card">
            <div className="text-xs text-gray-500">Cashback</div>
            <div className="text-lg font-bold">R$ {money(totals?.now.valor_cashback)}</div>
            {pctBadge(totals?.pct.valor_cashback)}
          </div>

          <div className="card">
            <div className="text-xs text-gray-500">Repasse</div>
            <div className="text-lg font-bold">R$ {money(totals?.now.valor_repasse_utilidades)}</div>
            {pctBadge(totals?.pct.valor_repasse_utilidades)}
          </div>

          <div className="card">
            <div className="text-xs text-gray-500">Total a pagar</div>
            <div className="text-lg font-bold">R$ {money(totals?.now.valor_total_pagar)}</div>
            {pctBadge(totals?.pct.valor_total_pagar)}
          </div>
        </div>

        {/* Lista */}
        <div className="mt-6 rounded border bg-white">
          <div className="grid grid-cols-12 bg-gray-50 p-3 text-xs font-semibold">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2">Cashback</div>
            <div className="col-span-2">Repasse</div>
            <div className="col-span-2">Total</div>
            <div className="col-span-1">Pagamento</div>
          </div>

          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 border-t p-3 text-sm">
              <div className="col-span-5">
                <b>{r.condominio_nome}</b>
                <div className="text-xs text-gray-500">
                  {r.cidade}/{r.uf} • {r.status}
                </div>
              </div>

              <div className="col-span-2">
                R$ {money(r.valor_cashback)}
                {pctBadge(r.pct_valor_cashback)}
              </div>

              <div className="col-span-2">
                R$ {money(r.valor_repasse_utilidades)}
                {pctBadge(r.pct_valor_repasse_utilidades)}
              </div>

              <div className="col-span-2 font-semibold">
                R$ {money(r.valor_total_pagar)}
                {pctBadge(r.pct_valor_total_pagar)}
              </div>

              <div className="col-span-1">{renderPagamento(r)}</div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
