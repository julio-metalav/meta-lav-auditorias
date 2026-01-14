export const runtime = "nodejs";

import Link from "next/link";

type Item = {
  mes: string;
  condominio_id: string | null;

  condominio: string | null;
  cidade: string | null;
  uf: string | null;

  cashback: number;
  cashback_prev: number;
  cashback_var_pct: number | null;

  repasse: number;
  repasse_prev: number;
  repasse_var_pct: number | null;

  total_pagar: number;

  pix: string | null;
  banco_nome: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;

  obs: string | null;
};

type ApiResp = {
  ok: boolean;
  mes: string;
  mes_anterior: string;
  itens: Item[];
  totais: { cashback: number; repasse: number; total_pagar: number };
};

function money(n: number) {
  const v = Number(n ?? 0);
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number | null) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  const s = v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v >= 0 ? "+" : ""}${s}%`;
}

function monthStart(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function parseMonth(s: string) {
  // espera YYYY-MM-01
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split("-").map((x) => Number(x));
  if (!y || !m) return null;
  return new Date(y, m - 1, 1);
}

function addMonths(yyyyMm01: string, delta: number) {
  const d = parseMonth(yyyyMm01);
  if (!d) return yyyyMm01;
  d.setMonth(d.getMonth() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function formatMes(yyyyMm01: string) {
  const d = parseMonth(yyyyMm01);
  if (!d) return yyyyMm01;
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

async function fetchRelatorio(mes: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/financeiro/relatorio?mes=${mes}`, {
    cache: "no-store",
  });

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const t = await res.text().catch(() => "");
    throw new Error(`API retornou ${res.status} (não-JSON). Trecho: ${t.slice(0, 180)}`);
  }

  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(json?.error ?? `Falha (${res.status})`);
  return json as ApiResp;
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: { mes?: string };
}) {
  const mes = typeof searchParams?.mes === "string" && searchParams.mes ? searchParams.mes : monthStart();

  let data: ApiResp | null = null;
  let err: string | null = null;

  try {
    data = await fetchRelatorio(mes);
  } catch (e: any) {
    err = e?.message ?? "Erro inesperado";
  }

  const mesPrev = data?.mes_anterior ?? addMonths(mes, -1);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold">Relatório financeiro (mensal)</div>
          <div className="mt-1 text-xs text-gray-500">
            Sintético por condomínio: <b>Cashback</b>, <b>Repasse</b>, <b>Total</b> e variação vs mês anterior.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" href="/auditorias">
            Voltar
          </Link>
        </div>
      </div>

      {/* Navegação de mês */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          href={`/relatorios?mes=${encodeURIComponent(addMonths(mes, -1))}`}
        >
          ← {formatMes(addMonths(mes, -1))}
        </Link>

        <div className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-semibold">
          {formatMes(mes)}
        </div>

        <Link
          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          href={`/relatorios?mes=${encodeURIComponent(addMonths(mes, 1))}`}
        >
          {formatMes(addMonths(mes, 1))} →
        </Link>
      </div>

      {err ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {!err && data ? (
        <>
          {/* Totais */}
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">Total Cashback (R$)</div>
              <div className="mt-1 text-lg font-extrabold">R$ {money(data.totais.cashback)}</div>
              <div className="mt-1 text-[11px] text-gray-500">
                Cashback = % da receita (no cadastro do condomínio).
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">Total Repasse (R$)</div>
              <div className="mt-1 text-lg font-extrabold">R$ {money(data.totais.repasse)}</div>
              <div className="mt-1 text-[11px] text-gray-500">
                Repasse = utilidades (água/energia/gás quando houver), pelas tarifas do cadastro.
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">Total a pagar (R$)</div>
              <div className="mt-1 text-lg font-extrabold">R$ {money(data.totais.total_pagar)}</div>
              <div className="mt-1 text-[11px] text-gray-500">Total = cashback + repasse.</div>
            </div>
          </div>

          {/* Lista */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
              <div className="col-span-5">Condomínio</div>
              <div className="col-span-2 text-right">Cashback</div>
              <div className="col-span-1 text-right">Δ%</div>
              <div className="col-span-2 text-right">Repasse</div>
              <div className="col-span-1 text-right">Δ%</div>
              <div className="col-span-1 text-right">Total</div>
            </div>

            {data.itens.map((it, idx) => {
              const name = it.condominio ?? "—";
              const loc = [it.cidade, it.uf].filter(Boolean).join("/");

              const cashVar = it.cashback_var_pct;
              const repVar = it.repasse_var_pct;

              return (
                <div key={`${it.condominio_id ?? "x"}-${idx}`} className="border-t border-gray-100 px-4 py-4">
                  <div className="grid grid-cols-12 items-start gap-2">
                    <div className="col-span-5">
                      <div className="text-sm font-extrabold">{name}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{loc || "—"}</div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {it.pix ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                            PIX: <b>{it.pix}</b>
                          </span>
                        ) : null}
                        {it.banco_nome || it.banco_agencia || it.banco_conta ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                            Banco: <b>{it.banco_nome ?? "—"}</b> • Ag: <b>{it.banco_agencia ?? "—"}</b> • Cc:{" "}
                            <b>{it.banco_conta ?? "—"}</b>
                          </span>
                        ) : null}
                      </div>

                      {it.obs ? (
                        <div className="mt-2 text-xs text-gray-600">
                          Obs: <span className="text-gray-800">{it.obs}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="col-span-2 text-right">
                      <div className="text-sm font-extrabold">R$ {money(it.cashback)}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Prev: R$ {money(it.cashback_prev)}</div>
                    </div>

                    <div className="col-span-1 text-right">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${
                          cashVar === null
                            ? "bg-gray-100 text-gray-600"
                            : cashVar >= 0
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                        title={cashVar === null ? `Sem base (mês anterior = 0)` : `Variação vs ${formatMes(mesPrev)}`}
                      >
                        {pct(cashVar)}
                      </span>
                    </div>

                    <div className="col-span-2 text-right">
                      <div className="text-sm font-extrabold">R$ {money(it.repasse)}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Prev: R$ {money(it.repasse_prev)}</div>
                    </div>

                    <div className="col-span-1 text-right">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${
                          repVar === null
                            ? "bg-gray-100 text-gray-600"
                            : repVar >= 0
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                        title={repVar === null ? `Sem base (mês anterior = 0)` : `Variação vs ${formatMes(mesPrev)}`}
                      >
                        {pct(repVar)}
                      </span>
                    </div>

                    <div className="col-span-1 text-right">
                      <div className="text-sm font-extrabold">R$ {money(it.total_pagar)}</div>
                    </div>
                  </div>
                </div>
              );
            })}

            {!data.itens.length ? (
              <div className="px-4 py-6 text-sm text-gray-600">Nenhum dado encontrado para este mês.</div>
            ) : null}
          </div>

          <div className="mt-3 text-[11px] text-gray-500">
            Δ% = variação percentual vs mês anterior (se o mês anterior = 0, mostramos “—”).
          </div>
        </>
      ) : null}
    </div>
  );
}
