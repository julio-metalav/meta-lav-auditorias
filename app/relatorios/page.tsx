import { headers } from "next/headers";
import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  condominio_id?: string | null;
  condominio_nome?: string | null;
  nome?: string | null;

  valor_cashback?: number | null;
  valor_repasse?: number | null;
  valor_repasse_utilidades?: number | null;
  valor_repasse_agua?: number | null;
  valor_repasse_energia?: number | null;
  valor_repasse_gas?: number | null;

  // variações (se vierem do backend)
  variacao_cashback_percent?: number | null;
  variacao_repasse_percent?: number | null;
  variacao_total_percent?: number | null;

  banco_nome?: string | null;
  banco_agencia?: string | null;
  banco_conta?: string | null;
  banco_pix?: string | null;
  pix?: string | null;
};

function money(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function asNum(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthISO(y: number, m1to12: number) {
  return `${y}-${pad2(m1to12)}-01`;
}

function parseMes(input: string | undefined | null) {
  // espera YYYY-MM-01 (ou YYYY-MM)
  const s = String(input ?? "").trim();
  if (!s) return null;

  const m = s.length >= 7 ? s.slice(0, 7) : "";
  const [yy, mm] = m.split("-").map((x) => Number(x));
  if (!yy || !mm || mm < 1 || mm > 12) return null;

  return { y: yy, m: mm, iso: monthISO(yy, mm) };
}

function shiftMonth(y: number, m: number, delta: number) {
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  return { y: d.getFullYear(), m: d.getMonth() + 1, iso: monthISO(d.getFullYear(), d.getMonth() + 1) };
}

function monthLabel(y: number, m: number) {
  const nomes = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  return `${nomes[m - 1]} de ${y}`;
}

function getBaseUrlFromHeaders() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "") ??
    "";
  if (!host) return "";
  return `${proto}://${host}`;
}

async function fetchFinance(mesISO: string) {
  const baseUrl = getBaseUrlFromHeaders();

  // fallback final (evita quebrar em build/local estranho)
  const abs = baseUrl
    ? `${baseUrl}/api/financeiro/relatorio?mes=${encodeURIComponent(mesISO)}`
    : `/api/financeiro/relatorio?mes=${encodeURIComponent(mesISO)}`;

  const res = await fetch(abs, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";

  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    const head = txt.slice(0, 220).replace(/\s+/g, " ").trim();
    throw new Error(`Failed to parse URL from /api/financeiro/relatorio?mes=${mesISO} (status ${res.status}). Trecho: ${head || "(vazio)"}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `Falha ao carregar relatório (${res.status})`);

  // tolera formatos diferentes
  const data = (json?.data ?? json?.rows ?? json?.itens ?? json ?? []) as any;
  const rows: Row[] = Array.isArray(data) ? data : Array.isArray(data?.itens) ? data.itens : Array.isArray(data?.data) ? data.data : [];
  return { raw: json, rows };
}

function VarBadge({ v }: { v: number | null | undefined }) {
  const n = v == null ? null : Number(v);
  if (n == null || !Number.isFinite(n)) return <span className="text-[11px] text-gray-400">—</span>;
  const up = n > 0;
  const down = n < 0;

  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        up ? "bg-green-50 text-green-700" : "",
        down ? "bg-red-50 text-red-700" : "",
        !up && !down ? "bg-gray-100 text-gray-600" : "",
      ].join(" ")}
      title="Variação vs mês anterior"
    >
      {pct(n)}
    </span>
  );
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  // default: mês atual
  const now = new Date();
  const def = { y: now.getFullYear(), m: now.getMonth() + 1, iso: monthISO(now.getFullYear(), now.getMonth() + 1) };

  const picked = parseMes(searchParams?.mes) ?? def;

  const prev = shiftMonth(picked.y, picked.m, -1);
  const next = shiftMonth(picked.y, picked.m, +1);

  let err: string | null = null;
  let rows: Row[] = [];

  try {
    const out = await fetchFinance(picked.iso);
    rows = out.rows;
  } catch (e: any) {
    err = e?.message ?? "Erro inesperado ao carregar relatório";
  }

  const normalized = (rows ?? []).map((r) => {
    const nome = String(r?.condominio_nome ?? r?.nome ?? "").trim();

    const cashback = asNum(r?.valor_cashback);
    const repasse =
      r?.valor_repasse_utilidades != null
        ? asNum(r?.valor_repasse_utilidades)
        : r?.valor_repasse != null
        ? asNum(r?.valor_repasse)
        : asNum(r?.valor_repasse_agua) + asNum(r?.valor_repasse_energia) + asNum(r?.valor_repasse_gas);

    const total = cashback + repasse;

    const pix = String(r?.banco_pix ?? r?.pix ?? "").trim();
    const bancoNome = String(r?.banco_nome ?? "").trim();
    const agencia = String(r?.banco_agencia ?? "").trim();
    const conta = String(r?.banco_conta ?? "").trim();

    const vbCash = r?.variacao_cashback_percent ?? null;
    const vbRep = r?.variacao_repasse_percent ?? null;
    const vbTot = r?.variacao_total_percent ?? null;

    return {
      id: String(r?.condominio_id ?? nome ?? ""),
      nome: nome || "(sem nome)",
      cashback,
      repasse,
      total,
      pix,
      bancoNome,
      agencia,
      conta,
      vbCash,
      vbRep,
      vbTot,
    };
  });

  const sumCash = normalized.reduce((acc, x) => acc + asNum(x.cashback), 0);
  const sumRep = normalized.reduce((acc, x) => acc + asNum(x.repasse), 0);
  const sumTot = normalized.reduce((acc, x) => acc + asNum(x.total), 0);

  return (
    <AppShell title="Relatórios">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-3xl font-extrabold">Relatório financeiro (mensal)</div>
            <div className="mt-1 text-sm text-gray-500">
              Sintético por condomínio: <b>Cashback</b>, <b>Repasse</b>, <b>Total</b> e variação vs mês anterior.
            </div>
          </div>

          <Link
            href="/auditorias"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
          >
            Voltar
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={`/relatorios?mes=${encodeURIComponent(prev.iso)}`}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
          >
            ← {monthLabel(prev.y, prev.m)}
          </Link>

          <div className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold">
            {monthLabel(picked.y, picked.m)}
          </div>

          <Link
            href={`/relatorios?mes=${encodeURIComponent(next.iso)}`}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
          >
            {monthLabel(next.y, next.m)} →
          </Link>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Totais do mês</div>
              <div className="text-xs text-gray-500">Soma de todos os condomínios listados.</div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-right">
              <div>
                <div className="text-xs text-gray-500">Cashback</div>
                <div className="text-lg font-extrabold">R$ {money(sumCash)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Repasse</div>
                <div className="text-lg font-extrabold">R$ {money(sumRep)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-lg font-extrabold">R$ {money(sumTot)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-4">Condomínio</div>
            <div className="col-span-2 text-right">Cashback</div>
            <div className="col-span-2 text-right">Repasse</div>
            <div className="col-span-2 text-right">Total</div>
            <div className="col-span-2">PIX / Banco</div>
          </div>

          {normalized.length === 0 && !err ? (
            <div className="px-4 py-6 text-sm text-gray-500">Nenhum dado para este mês.</div>
          ) : null}

          {normalized.map((x) => (
            <div key={x.id} className="grid grid-cols-12 items-center gap-2 border-t border-gray-100 px-4 py-3">
              <div className="col-span-4">
                <div className="text-sm font-semibold">{x.nome}</div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-sm font-extrabold">R$ {money(x.cashback)}</div>
                <div className="mt-0.5 text-[11px]">
                  <VarBadge v={x.vbCash} />
                </div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-sm font-extrabold">R$ {money(x.repasse)}</div>
                <div className="mt-0.5 text-[11px]">
                  <VarBadge v={x.vbRep} />
                </div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-sm font-extrabold">R$ {money(x.total)}</div>
                <div className="mt-0.5 text-[11px]">
                  <VarBadge v={x.vbTot} />
                </div>
              </div>

              <div className="col-span-2">
                {x.pix ? (
                  <div className="text-xs">
                    <div className="font-semibold">PIX</div>
                    <div className="text-gray-600 break-all">{x.pix}</div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-600">
                    {x.bancoNome ? <div className="font-semibold">{x.bancoNome}</div> : null}
                    {x.agencia || x.conta ? (
                      <div>
                        {x.agencia ? <>Ag {x.agencia}</> : null}
                        {x.agencia && x.conta ? " • " : null}
                        {x.conta ? <>Cc {x.conta}</> : null}
                      </div>
                    ) : (
                      <div className="text-gray-400">—</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Observação: <b>Repasse</b> é utilidades (água/energia/gás onde houver) com tarifas no cadastro do condomínio. <b>Cashback</b> é percentual sobre a receita.
        </div>
      </div>
    </AppShell>
  );
}
