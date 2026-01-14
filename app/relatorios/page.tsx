"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Row = {
  mes_ref: string | null;

  condominio_id: string;
  condominio_nome: string | null;
  cidade: string | null;
  uf: string | null;

  valor_total_pagar: number | null;
  valor_cashback: number | null;
  valor_repasse_utilidades: number | null;

  valor_repasse_agua: number | null;
  valor_repasse_energia: number | null;
  valor_repasse_gas: number | null;

  favorecido_nome: string | null;
  banco_nome: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;
  banco_pix: string | null;

  status: string | null;
  auditoria_id: string | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function addMonths(iso: string, delta: number) {
  if (!iso || iso.length < 10) return iso;
  const [y, m] = iso.slice(0, 10).split("-").map((x) => Number(x));
  if (!y || !m) return iso;
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  return monthISO(d);
}

function labelMes(iso: string) {
  if (!iso || iso.length < 7) return "—";
  const [y, m] = iso.slice(0, 7).split("-").map((x) => Number(x));
  if (!y || !m) return iso;
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[m - 1]}/${y}`;
}

function money(v: any) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    const head = text.slice(0, 240).replace(/\s+/g, " ").trim();
    throw new Error(`${url} retornou ${res.status} (não-JSON). Trecho: ${head || "(vazio)"}`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `${url} falhou (${res.status})`);
  return json;
}

export default function RelatoriosPage() {
  const [mesRef, setMesRef] = useState<string>(() => monthISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tituloMes = useMemo(() => labelMes(mesRef), [mesRef]);

  async function carregar(m: string) {
    setLoading(true);
    setErr(null);

    try {
      const url = `/api/financeiro/relatorio?mes=${encodeURIComponent(m)}`;
      const json = await fetchJSON(url, { cache: "no-store" });

      const list = (json?.rows ?? []) as any[];
      const normalized: Row[] = list.map((x: any) => ({
        mes_ref: x?.mes_ref ?? null,

        condominio_id: String(x?.condominio_id ?? ""),
        condominio_nome: x?.condominio_nome ?? null,
        cidade: x?.cidade ?? null,
        uf: x?.uf ?? null,

        valor_total_pagar: x?.valor_total_pagar !== undefined ? Number(x.valor_total_pagar ?? 0) : 0,
        valor_cashback: x?.valor_cashback !== undefined ? Number(x.valor_cashback ?? 0) : 0,
        valor_repasse_utilidades: x?.valor_repasse_utilidades !== undefined ? Number(x.valor_repasse_utilidades ?? 0) : 0,

        valor_repasse_agua: x?.valor_repasse_agua !== undefined ? Number(x.valor_repasse_agua ?? 0) : 0,
        valor_repasse_energia: x?.valor_repasse_energia !== undefined ? Number(x.valor_repasse_energia ?? 0) : 0,
        valor_repasse_gas: x?.valor_repasse_gas !== undefined ? Number(x.valor_repasse_gas ?? 0) : 0,

        favorecido_nome: x?.favorecido_nome ?? null,
        banco_nome: x?.banco_nome ?? null,
        banco_agencia: x?.banco_agencia ?? null,
        banco_conta: x?.banco_conta ?? null,
        banco_pix: x?.banco_pix ?? null,

        status: x?.status ?? null,
        auditoria_id: x?.auditoria_id ?? null,
      }));

      setRows(normalized);
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar(mesRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesRef]);

  const totais = useMemo(() => {
    const sum = (key: keyof Row) => rows.reduce((acc, r) => acc + Number((r[key] as any) ?? 0), 0);
    return {
      cashback: sum("valor_cashback"),
      repasse: sum("valor_repasse_utilidades"),
      total: sum("valor_total_pagar"),
    };
  }, [rows]);

  return (
    <AppShell title="Relatórios (Financeiro)">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-extrabold">Relatório Financeiro</div>
            <div className="mt-1 text-xs text-gray-500">
              Mês: <b>{tituloMes}</b> • mes_ref: <b>{mesRef}</b>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={() => setMesRef(addMonths(mesRef, -1))}
              disabled={loading}
            >
              ← {labelMes(addMonths(mesRef, -1))}
            </button>

            <button
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={() => carregar(mesRef)}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>

            <button
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={() => setMesRef(addMonths(mesRef, 1))}
              disabled={loading}
            >
              {labelMes(addMonths(mesRef, 1))} →
            </button>
          </div>
        </div>

        {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div> : null}

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Cashback (total)</div>
            <div className="mt-1 text-lg font-extrabold">R$ {money(totais.cashback)}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Repasse utilidades (total)</div>
            <div className="mt-1 text-lg font-extrabold">R$ {money(totais.repasse)}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Total a pagar (cashback + repasse)</div>
            <div className="mt-1 text-lg font-extrabold">R$ {money(totais.total)}</div>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="grid grid-cols-12 gap-2 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-4">Condomínio</div>
            <div className="col-span-2">Cashback</div>
            <div className="col-span-2">Repasse</div>
            <div className="col-span-2">Total</div>
            <div className="col-span-2">PIX / Banco</div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">{loading ? "Carregando..." : "Sem dados para este mês."}</div>
          ) : (
            rows.map((r, idx) => (
              <div key={`${r.condominio_id}-${idx}`} className="grid grid-cols-12 gap-2 border-t border-gray-100 px-4 py-3">
                <div className="col-span-4">
                  <div className="text-sm font-semibold">{r.condominio_nome ?? "—"}</div>
                  <div className="text-xs text-gray-500">
                    {r.cidade ?? "—"}/{r.uf ?? "—"} • status: <b>{r.status ?? "—"}</b>
                  </div>
                  {r.auditoria_id ? (
                    <div className="mt-1 text-[11px] text-gray-400">
                      auditoria_id: <span className="font-mono">{r.auditoria_id}</span>
                    </div>
                  ) : null}
                </div>

                <div className="col-span-2 text-sm">R$ {money(r.valor_cashback)}</div>
                <div className="col-span-2 text-sm">R$ {money(r.valor_repasse_utilidades)}</div>
                <div className="col-span-2 text-sm font-semibold">R$ {money(r.valor_total_pagar)}</div>

                <div className="col-span-2">
                  {r.banco_pix ? (
                    <div className="text-xs">
                      <div className="font-semibold">PIX</div>
                      <div className="break-all text-gray-600">{r.banco_pix}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">
                      {r.banco_nome ? (
                        <>
                          <div className="font-semibold">{r.banco_nome}</div>
                          <div className="text-gray-600">
                            Ag {r.banco_agencia ?? "—"} • Cc {r.banco_conta ?? "—"}
                          </div>
                        </>
                      ) : (
                        "Sem dados bancários"
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Obs: este relatório é sintético. Tarifas ficam no cadastro do condomínio; consumo vem do fechamento (base vs leitura atual).
        </div>
      </div>
    </AppShell>
  );
}
