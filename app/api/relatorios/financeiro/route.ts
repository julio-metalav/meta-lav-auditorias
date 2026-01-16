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
  // Aceita "2026-01-01" ou "2026-01"
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
  // mantém número, formatação é do export (xlsx/pdf)
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
  // PIX tem prioridade
  const pix = pickFirst(condo, ["pix", "pix_chave", "chave_pix", "pix_key", "pixkey"]);
  const doc = pickFirst(condo, ["cnpj", "cpf", "documento", "doc", "cnpj_cpf", "cpf_cnpj"]);
  if (pix) {
    return `PIX: ${String(pix)}${doc ? ` • CNPJ/CPF: ${String(doc)}` : ""}`;
  }

  const bancoNome = pickFirst(condo, ["banco_nome", "banco", "nome_banco"]);
  const bancoCod = pickFirst(condo, ["banco_codigo", "codigo_banco", "banco_cod"]);
  const agencia = pickFirst(condo, ["agencia", "agencia_num", "agencia_banco"]);
  const conta = pickFirst(condo, ["conta", "conta_num", "numero_conta"]);
  const titular = pickFirst(condo, ["titular", "titular_conta", "nome_titular"]);
  const bancoLabel =
    bancoNome && bancoCod ? `${bancoNome} (${bancoCod})` : bancoNome ? String(bancoNome) : bancoCod ? `Banco ${bancoCod}` : "Banco";

  const parts: string[] = [];
  parts.push(bancoLabel);
  if (agencia) parts.push(`Agência: ${String(agencia)}`);
  if (conta) parts.push(`Conta: ${String(conta)}`);
  if (titular) parts.push(`Titular: ${String(titular)}`);
  if (doc) parts.push(`CNPJ/CPF: ${String(doc)}`);

  return parts.join(" • ");
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
  // Vercel: usa host da request (mesmo domínio)
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

async function getTotaisDaAuditoria(req: Request, auditoriaId: string) {
  const base = getBaseUrl(req);
  const cookie = req.headers.get("cookie");

  // 1) tenta /ciclos
  try {
    const j = await fetchJsonWithCookie(`${base}/api/auditorias/${auditoriaId}/ciclos`, cookie);
    const itens = j?.data?.itens ?? [];
    // total_vendas (receita bruta) = soma(ciclos * valor_ciclo)
    const receita = itens.reduce((acc: number, it: any) => acc + safeNum(it?.ciclos) * safeNum(it?.valor_ciclo), 0);

    // cashback: % sobre receita bruta pode estar vindo do backend da auditoria; se não, calculamos depois via condo
    // repasse/total_a_pagar: neste sistema, pelo print, total a pagar = receita (cashback + repasse = receita)
    // então repasse = receita - cashback
    // (o cashback % está no condomínio. Vamos retornar receita e deixar o route principal quebrar em repasse/cashback)
    return { receita_bruta: money2(receita) };
  } catch {
    // segue pro fallback
  }

  // 2) fallback /auditorias/[id]
  try {
    const j = await fetchJsonWithCookie(`${base}/api/auditorias/${auditoriaId}`, cookie);
    const a = j?.data ?? j;
    // tenta pegar campos “defensivos”
    const total = safeNum(pickFirst(a, ["total", "total_a_pagar", "total_a_pagar_rs", "total_a_pagar_brl"]));
    const repasse = safeNum(pickFirst(a, ["total_repasse", "repasse_total", "repasse"]));
    const cashback = safeNum(pickFirst(a, ["total_cashback", "cashback_total", "cashback"]));
    if (total || repasse || cashback) {
      return {
        total_a_pagar: money2(total),
        total_repasse: money2(repasse),
        total_cashback: money2(cashback),
      };
    }
  } catch {
    // ignore
  }

  return { receita_bruta: 0 };
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

    // ✅ mês anterior para variação: considerar final + em_conferencia (senão vira sempre 0)
    const { data: audPrev, error: prevErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("mes_ref", mesAnterior)
      .in("status", ["final", "em_conferencia"]);

    if (prevErr) return bad("Erro ao buscar auditorias mês anterior", 500, { details: prevErr.message });

    // Mapa totals mês anterior por condomínio
    const prevByCondo = new Map<string, number>();

    for (const a of (audPrev ?? []) as any[]) {
      const tid = String(a.id);
      const totals = await getTotaisDaAuditoria(req, tid);
      const condo = condoById.get(String(a.condominio_id));
      const cashbackPct = safeNum(pickFirst(condo, ["cashback_percent", "cashback", "percent_cashback"])) || 0;

      const receita = safeNum((totals as any).receita_bruta);
      const cashback = money2(receita * (cashbackPct / 100));
      const repasse = money2(receita - cashback);
      const total = money2(repasse + cashback);

      const key = String(a.condominio_id);
      prevByCondo.set(key, money2((prevByCondo.get(key) || 0) + total));
    }

    const items: any[] = [];

    for (const a of (auds ?? []) as any[]) {
      const condo = condoById.get(String(a.condominio_id)) || {};
      const pagamento_texto = buildPagamentoTexto(condo);
      const cashbackPct = safeNum(pickFirst(condo, ["cashback_percent", "cashback", "percent_cashback"])) || 0;

      const totals = await getTotaisDaAuditoria(req, String(a.id));

      let repasse = 0;
      let cashback = 0;
      let total = 0;

      if ((totals as any).total_a_pagar || (totals as any).total_repasse || (totals as any).total_cashback) {
        repasse = money2(safeNum((totals as any).total_repasse));
        cashback = money2(safeNum((totals as any).total_cashback));
        total = money2(safeNum((totals as any).total_a_pagar) || repasse + cashback);
      } else {
        const receita = safeNum((totals as any).receita_bruta);
        cashback = money2(receita * (cashbackPct / 100));
        repasse = money2(receita - cashback);
        total = money2(repasse + cashback);
      }

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

    // ordena por nome do condomínio
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
