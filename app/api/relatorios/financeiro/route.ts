export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function parseMesRef(input: string | null) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return null;
}

function monthKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function addMonths(isoYYYYMMDD: string, delta: number) {
  const d = new Date(`${isoYYYYMMDD}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const newD = new Date(Date.UTC(y, m + delta, 1));
  return monthKey(newD);
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return v;
  }
  return null;
}

function buildPagamentoTexto(condo: any) {
  const doc = pickFirst(condo, ["cnpj", "cpf", "documento", "doc", "cnpj_cpf", "cpf_cnpj"]);

  // 1️⃣ TENTA DADOS BANCÁRIOS PRIMEIRO
  const bancoNome = pickFirst(condo, ["banco_nome", "banco", "nome_banco"]);
  const bancoCod = pickFirst(condo, ["banco_codigo", "codigo_banco", "banco_cod"]);
  const agencia = pickFirst(condo, ["agencia", "agencia_num", "agencia_banco"]);
  const conta = pickFirst(condo, ["conta", "conta_num", "numero_conta"]);
  const titular = pickFirst(condo, ["titular", "titular_conta", "nome_titular"]);

  const temDadosBancarios = bancoNome || bancoCod || agencia || conta;

  if (temDadosBancarios) {
    const bancoLabel =
      bancoNome && bancoCod
        ? `${bancoNome} (${bancoCod})`
        : bancoNome
        ? String(bancoNome)
        : bancoCod
        ? `Banco ${bancoCod}`
        : "Banco";

    const parts: string[] = [];
    parts.push(bancoLabel);
    if (agencia) parts.push(`Agência: ${String(agencia)}`);
    if (conta) parts.push(`Conta: ${String(conta)}`);
    if (titular) parts.push(`Titular: ${String(titular)}`);
    if (doc) parts.push(`CNPJ/CPF: ${String(doc)}`);

    return parts.join(" • ");
  }

  // 2️⃣ FALLBACK PARA PIX (SÓ SE NÃO TIVER CONTA)
  const pix = pickFirst(condo, ["pix", "pix_chave", "chave_pix", "pix_key", "pixkey"]);
  if (pix) {
    return `PIX: ${String(pix)}${doc ? ` • CNPJ/CPF: ${String(doc)}` : ""}`;
  }

  // 3️⃣ NADA CADASTRADO
  return "Forma de pagamento não cadastrada";
}

async function fetchJsonWithCookie(url: string, cookie: string | null) {
  const res = await fetch(url, {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(json?.error || text || `HTTP ${res.status}`);
  }
  return json;
}

function getBaseUrl(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Tenta extrair o custo total de INSUMOS da auditoria.
 * Ordem:
 * 1) campos "totais" já prontos (total_insumos/consumos_total/etc)
 * 2) soma de campos de custo (valor_agua, valor_energia, valor_gas, valor_produtos, etc)
 * 3) cálculo por leitura * tarifa (se existir leitura anterior/base e tarifa)
 */
function extractInsumosTotal(a: any): number {
  // 1) Totais prontos
  const totalPronto = safeNum(
    pickFirst(a, [
      "total_insumos",
      "insumos_total",
      "total_consumos",
      "consumos_total",
      "repasse_consumos",
      "repasse_insumos",
      "valor_insumos",
      "custo_insumos",
      "custo_total_insumos",
      "total_custos",
    ])
  );
  if (totalPronto > 0) return money2(totalPronto);

  // 2) Soma por componentes (se existirem)
  const aguaV = safeNum(pickFirst(a, ["valor_agua", "agua_valor", "custo_agua", "agua_custo"]));
  const energiaV = safeNum(pickFirst(a, ["valor_energia", "energia_valor", "custo_energia", "energia_custo"]));
  const gasV = safeNum(pickFirst(a, ["valor_gas", "gas_valor", "custo_gas", "gas_custo"]));
  const produtosV = safeNum(
    pickFirst(a, ["valor_produtos", "produtos_valor", "custo_produtos", "quimicos_valor", "insumos_quimicos_valor"])
  );
  const outrosV = safeNum(pickFirst(a, ["valor_outros", "outros_valor", "custo_outros"]));

  const somaComponentes = aguaV + energiaV + gasV + produtosV + outrosV;
  if (somaComponentes > 0) return money2(somaComponentes);

  // 3) Cálculo por leitura * tarifa (se tiver)
  const aguaLeitura = safeNum(pickFirst(a, ["agua_leitura", "leitura_agua", "leitura_agua_atual"]));
  const aguaBase = safeNum(pickFirst(a, ["agua_leitura_base", "base_agua", "leitura_agua_base", "leitura_agua_anterior"]));
  const aguaTarifa = safeNum(pickFirst(a, ["agua_tarifa", "tarifa_agua", "valor_m3_agua", "agua_valor_m3", "agua_preco_m3"]));

  const energiaLeitura = safeNum(pickFirst(a, ["energia_leitura", "leitura_energia", "leitura_energia_atual"]));
  const energiaBase = safeNum(
    pickFirst(a, ["energia_leitura_base", "base_energia", "leitura_energia_base", "leitura_energia_anterior"])
  );
  const energiaTarifa = safeNum(
    pickFirst(a, ["energia_tarifa", "tarifa_energia", "valor_kwh", "energia_valor_kwh", "energia_preco_kwh"])
  );

  const gasLeitura = safeNum(pickFirst(a, ["gas_leitura", "leitura_gas", "leitura_gas_atual"]));
  const gasBase = safeNum(pickFirst(a, ["gas_leitura_base", "base_gas", "leitura_gas_base", "leitura_gas_anterior"]));
  const gasTarifa = safeNum(pickFirst(a, ["gas_tarifa", "tarifa_gas", "valor_m3_gas", "gas_valor_m3", "gas_preco_m3"]));

  const aguaCons = Math.max(0, aguaLeitura - aguaBase);
  const energiaCons = Math.max(0, energiaLeitura - energiaBase);
  const gasCons = Math.max(0, gasLeitura - gasBase);

  const calc = aguaCons * aguaTarifa + energiaCons * energiaTarifa + gasCons * gasTarifa;
  if (calc > 0) return money2(calc);

  return 0;
}

async function getReceitaBruta(req: Request, auditoriaId: string) {
  const base = getBaseUrl(req);
  const cookie = req.headers.get("cookie");

  try {
    const j = await fetchJsonWithCookie(`${base}/api/auditorias/${auditoriaId}/ciclos`, cookie);
    const itens = j?.data?.itens ?? [];
    const receita = itens.reduce((acc: number, it: any) => acc + safeNum(it?.ciclos) * safeNum(it?.valor_ciclo), 0);
    return money2(receita);
  } catch {
    return 0;
  }
}

async function getInsumos(req: Request, auditoriaId: string) {
  const base = getBaseUrl(req);
  const cookie = req.headers.get("cookie");

  try {
    const j = await fetchJsonWithCookie(`${base}/api/auditorias/${auditoriaId}`, cookie);
    const a = j?.data ?? j;
    return extractInsumosTotal(a);
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = parseMesRef(url.searchParams.get("mes_ref"));
    if (!mes_ref) return bad("Parâmetro mes_ref inválido. Use YYYY-MM-01", 400);

    const mesAnterior = addMonths(mes_ref, -1);

    // ✅ mês do relatório: SOMENTE em_conferencia
    const { data: auds, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("mes_ref", mes_ref)
      .eq("status", "em_conferencia");

    if (audErr) return bad("Erro ao buscar auditorias", 500, { details: audErr.message });

    const condIds = Array.from(new Set((auds ?? []).map((a: any) => a.condominio_id).filter(Boolean)));

    const { data: condos, error: cErr } = await supabaseAdmin()
      .from("condominios")
      .select("*")
      .in("id", condIds.length ? condIds : ["00000000-0000-0000-0000-000000000000"]);

    if (cErr) return bad("Erro ao buscar condomínios", 500, { details: cErr.message });

    const condoById = new Map<string, any>((condos ?? []).map((c: any) => [c.id, c]));

    // ✅ mês anterior para variação: considerar final + em_conferencia
    const { data: audPrev, error: prevErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("mes_ref", mesAnterior)
      .in("status", ["final", "em_conferencia"]);

    if (prevErr) return bad("Erro ao buscar auditorias mês anterior", 500, { details: prevErr.message });

    // Mapa totals mês anterior por condomínio
    const prevByCondo = new Map<string, number>();

    for (const a of (audPrev ?? []) as any[]) {
      const condo = condoById.get(String(a.condominio_id)) || {};
      const cashbackPct = safeNum(pickFirst(condo, ["cashback_percent", "cashback", "percent_cashback"])) || 0;

      const receita = await getReceitaBruta(req, String(a.id));
      const insumos = await getInsumos(req, String(a.id));

      const cashback = money2(receita * (cashbackPct / 100));
      const repasse = money2(insumos);
      const total = money2(repasse + cashback);

      const key = String(a.condominio_id);
      prevByCondo.set(key, money2((prevByCondo.get(key) || 0) + total));
    }

    const items: any[] = [];

    for (const a of (auds ?? []) as any[]) {
      const condo = condoById.get(String(a.condominio_id)) || {};
      const pagamento_texto = buildPagamentoTexto(condo);
      const cashbackPct = safeNum(pickFirst(condo, ["cashback_percent", "cashback", "percent_cashback"])) || 0;

      const receita = await getReceitaBruta(req, String(a.id));
      const insumos = await getInsumos(req, String(a.id));

      const cashback = money2(receita * (cashbackPct / 100));
      const repasse = money2(insumos); // ✅ repasse = INSUMOS (consumos)
      const total = money2(repasse + cashback); // ✅ total a pagar = insumos + cashback

      const prevTotal = prevByCondo.get(String(a.condominio_id)) || 0;
      const variacao = prevTotal > 0 ? (total - prevTotal) / prevTotal : 0;

      items.push({
        auditoria_id: a.id,
        condominio_id: a.condominio_id,
        condominio_nome: String(pickFirst(condo, ["nome"]) ?? ""),
        pagamento_texto,
        repasse,
        cashback,
        total,
        variacao,
      });
    }

    items.sort((x, y) => String(x.condominio_nome).localeCompare(String(y.condominio_nome), "pt-BR"));

    return NextResponse.json({
      ok: true,
      mes_ref,
      mes_ref_anterior: mesAnterior,
      itens: items,
    });
  } catch (e: any) {
    return bad("Falha ao gerar base do relatório", 500, { details: e?.message ?? String(e) });
  }
}
