"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Item = {
  condominio_id: string | null;
  condominio: string;

  banco_nome?: string | null;
  banco_agencia?: string | null;
  banco_conta?: string | null;
  banco_pix?: string | null;

  cashback: number;
  repasse: number;
  total: number;

  variacao?: {
    cashback_percent: number | null;
    repasse_percent: number | null;
    total_percent: number | null;
  } | null;
};

type ApiResp = {
  ok: boolean;
  mes: string;
  mes_anterior: string;
  totais: { cashback: number; repasse: number; total: number };
  itens: Item[];
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function addMonths(isoMonth: string, delta: number) {
  const [y, m] = isoMonth.slice(0, 10).split("-").map((x) => Number(x));
  const d = new Date(y, (m || 1) - 1, 1);
  d.setMonth(d.getMonth() + delta);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function labelMes(isoMonth: string) {
  const [y, m] = isoMonth.slice(0, 10).split("-").map((x) => Number(x));
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function money(n: number) {
  return (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchJSON(url: string) {
  // no browser, cookie vai junto automaticamente por ser same-origin
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";

  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    const head = text.slice(0, 220).replace(/\s+/g, " ").trim();
    throw new Error(`${url} retornou ${res.status} (não-JSON). Trecho: ${head || "(vazio)"}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `${url} falhou (${res.status})`);
  return json;
}

export default function RelatoriosPage() {
  const [mes, setMes] = useState<string>(() => monthISO());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tituloMes = useMemo(() => labelMes(mes), [mes]);

  async function carregar(m: string) {
    setLoading(true);
    setErr(null);

    try {
      const url = `/api/financeiro/relatorio?mes=${encodeURIComponent(m)}`;
      const json = (await fetchJSON(url)) as ApiResp;
      setData(json);
    } catch (e: any) {
      setData(null);
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  return (
    <AppShell title="Relatórios">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold">Relatório financeiro (mensal)</div>
            <div className="mt-1 text-sm text-gray-500">
              Sintético por condomínio: <b>Cashback</b>, <b>Repasse</b>, <b>Total</b> e variação vs mês anterior.
            </div>
          </div>

          <a className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" href="/">
            Voltar
          </a>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setMes(addMonths(mes, -1))}
            disabled={loading}
          >
            ← {labelMes(addMonths(mes, -1))}
          </button>

          <div className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-semibold">
            {tituloMes}
          </div>

          <button
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setMes(addMonths(mes, 1))}
            disabled={loading}
          >
            {labelMes(addMonths(mes, 1))} →
          </button>

          <button
            className="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => carregar(mes)}
            disabled={loading}
          >
            {loading ? "Carregando..." : "Recarregar"}
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Totais do mês</div>
              <div className="text-xs text-gray-500">Soma de todos os condomínios listados.</div>
            </div>

            <div className="flex items-end gap-6">
              <div className="text-right">
                <div className="text-xs text-gray-500">Cashback</div>
                <div className="text-lg font-extrabold">R$ {money(data?.totais?.cashback ?? 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Repasse</div>
                <div className="text-lg font-extrabold">R$ {money(data?.totais?.repasse ?? 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-lg font-extrabold">R$ {money(data?.totais?.total ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2 text-right">Cashback</div>
            <div className="col-span-2 text-right">Repasse</div>
            <div className="col-span-3 text-right">Total / PIX / Banco</div>
          </div>

          {(data?.itens ?? []).length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">{loading ? "Carregando..." : "Sem dados para este mês."}</div>
          ) : (
            (data?.itens ?? []).map((it, idx) => {
              const bank =
                it.banco_pix
                  ? `PIX: ${it.banco_pix}`
                  : it.banco_nome || it.banco_agencia || it.banco_conta
                    ? `${it.banco_nome ?? ""} ${it.banco_agencia ? `Ag ${it.banco_agencia}` : ""} ${
                        it.banco_conta ? `Cc ${it.banco_conta}` : ""
                      }`.trim()
                    : "—";

              return (
                <div key={`${it.condominio_id ?? "x"}-${idx}`} className="grid grid-cols-12 items-center px-4 py-3">
                  <div className="col-span-5">
                    <div className="text-sm font-semibold">{it.condominio}</div>
                    <div className="text-[11px] text-gray-500">{it.condominio_id ?? ""}</div>
                  </div>

                  <div className="col-span-2 text-right">
                    <div className="text-sm font-semibold">R$ {money(it.cashback)}</div>
                    {it.variacao?.cashback_percent != null ? (
                      <div className="text-[11px] text-gray-500">{it.variacao.cashback_percent.toFixed(1)}%</div>
                    ) : (
                      <div className="text-[11px] text-gray-400">—</div>
                    )}
                  </div>

                  <div className="col-span-2 text-right">
                    <div className="text-sm font-semibold">R$ {money(it.repasse)}</div>
                    {it.variacao?.repasse_percent != null ? (
                      <div className="text-[11px] text-gray-500">{it.variacao.repasse_percent.toFixed(1)}%</div>
                    ) : (
                      <div className="text-[11px] text-gray-400">—</div>
                    )}
                  </div>

                  <div className="col-span-3 text-right">
                    <div className="text-sm font-extrabold">R$ {money(it.total)}</div>
                    <div className="text-[11px] text-gray-500">{bank}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Observação: <b>Repasse</b> é utilidades (água/energia/gás onde houver) com tarifas no cadastro do condomínio.{" "}
          <b>Cashback</b> é percentual sobre a receita.
        </div>
      </div>
    </AppShell>
  );
}
