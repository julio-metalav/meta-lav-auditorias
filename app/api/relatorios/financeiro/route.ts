export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normDoc(v: any) {
  const s = String(v ?? "").trim();
  return s || "";
}

function getBaseUrlFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.headers.get(":authority");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

function parseMesRef(mesRef: string) {
  const d = new Date(mesRef);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function previousMonthISO(mesRef: string) {
  const d = parseMesRef(mesRef);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return prev.toISOString().slice(0, 10); // YYYY-MM-01
}

function buildPagamentoTexto(condo: any) {
  const pix = String(condo?.pix_chave ?? condo?.pix ?? condo?.chave_pix ?? "").trim();
  const doc = normDoc(condo?.cnpj ?? condo?.cpf ?? condo?.documento ?? condo?.doc ?? "");

  if (pix) {
    const docPart = doc ? ` • CNPJ/CPF: ${doc}` : "";
    return `PIX: ${pix}${docPart}`;
  }

  // Banco/agencia/conta (tenta varios nomes comuns)
  const bancoNome = String(condo?.banco_nome ?? condo?.banco ?? "").trim();
  const bancoCod = String(condo?.banco_codigo ?? condo?.codigo_banco ?? "").trim();
  const agencia = String(condo?.agencia ?? condo?.conta_agencia ?? "").trim();
  const conta = String(condo?.conta ?? condo?.conta_numero ?? "").trim();

  const bancoLabel =
    bancoCod && bancoNome
      ? `Banco (${bancoCod}): ${bancoNome}`
      : bancoNome
        ? `Banco: ${bancoNome}`
        : bancoCod
          ? `Banco (${bancoCod})`
          : "Banco";

  const agPart = agencia ? ` • Agência: ${agencia}` : "";
  const contaPart = conta ? ` • Conta: ${conta}` : "";
  const docPart = doc ? ` • CNPJ/CPF: ${doc}` : "";

  return `${bancoLabel}${agPart}${contaPart}${docPart}`.trim();
}

async function fetchTotaisViaCiclos(req: Request, auditoriaId: string) {
  // tenta buscar a estrutura da rota /ciclos (que tem itens e valor_ciclo)
  const baseUrl = getBaseUrlFromReq(req);
  if (!baseUrl) return null;

  const cookie = req.headers.get("cookie") || "";

  const r = await fetch(`${baseUrl}/api/auditorias/${auditoriaId}/ciclos`, {
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  }).catch(() => null);

  if (!r || !r.ok) return null;

  const j: any = await r.json().catch(() => null);
  const itens: any[] = Array.isArray(j?.data?.itens) ? j.data.itens : [];

  // receita bruta = soma(ciclos * valor_ciclo)
  let receita = 0;
  for (const it of itens) {
    const ciclos = safeNum(it?.ciclos, 0);
    const valor = safeNum(it?.valor_ciclo, 0);
    receita += ciclos * valor;
  }

  return { receita_bruta: receita };
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = url.searchParams.get("mes_ref") || "";
    if (!mes_ref) return bad("Parâmetro mes_ref obrigatório (YYYY-MM-01)", 400);

    const prevMes = previousMonthISO(mes_ref);

    // ✅ mês atual: SOMENTE em_conferencia (não entra final)
    const { data: auds, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("mes_ref", mes_ref)
      .eq("status", "em_conferencia");

    if (audErr) return bad(audErr.message, 500);

    const condIds = Array.from(new Set((auds ?? []).map((a: any) => a.condominio_id).filter(Boolean)));

    // condominios com select("*") pra não quebrar por coluna inexistente
    const condoMap = new Map<string, any>();
    if (condIds.length) {
      const { data: condos, error: condoErr } = await supabaseAdmin()
        .from("condominios")
        .select("*")
        .in("id", condIds as any);

      if (condoErr) return bad(condoErr.message, 500);

      for (const c of condos ?? []) {
        condoMap.set(String((c as any).id), c);
      }
    }

    // ✅ mês anterior (só para variação): em_conferencia OU final
    const prevTotalsByCondo = new Map<string, number>();
    if (prevMes) {
      const { data: prevAuds, error: prevErr } = await supabaseAdmin()
        .from("auditorias")
        .select("id, condominio_id, mes_ref, status")
        .eq("mes_ref", prevMes)
        .in("status", ["em_conferencia", "final"]);

      if (prevErr) return bad(prevErr.message, 500);

      // soma por condominio (se tiver mais de 1 auditoria no mesmo mês)
      for (const a of prevAuds ?? []) {
        const audId = String((a as any).id);
        const condoId = String((a as any).condominio_id);

        const totalsViaCiclos = await fetchTotaisViaCiclos(req, audId);
        const receita = safeNum(totalsViaCiclos?.receita_bruta, 0);

        prevTotalsByCondo.set(condoId, safeNum(prevTotalsByCondo.get(condoId), 0) + receita);
      }
    }

    const rows: any[] = [];

    for (const a of auds ?? []) {
      const audId = String((a as any).id);
      const condoId = String((a as any).condominio_id);
      const condo = condoMap.get(condoId) ?? {};

      // receita atual via /ciclos
      const totalsViaCiclos = await fetchTotaisViaCiclos(req, audId);
      const receita = safeNum(totalsViaCiclos?.receita_bruta, 0);

      // cashback %
      const cashbackPercent = safeNum(
        condo?.cashback_percent ?? condo?.cashback ?? condo?.percent_cashback ?? 0,
        0
      );

      const cashback = receita * (cashbackPercent / 100);
      const repasse = Math.max(0, receita - cashback);
      const total = repasse + cashback; // total pago ao condomínio (repasse + cashback)

      const prev = safeNum(prevTotalsByCondo.get(condoId), 0);
      const variacao = prev > 0 ? (total - prev) / prev : 0;

      rows.push({
        auditoria_id: audId,
        condominio_id: condoId,
        condominio_nome: String(condo?.nome ?? "Condomínio"),
        pagamento_texto: buildPagamentoTexto(condo),

        repasse,
        cashback,
        total,

        variacao_percent: variacao,
      });
    }

    // ordena por nome
    rows.sort((x, y) => String(x.condominio_nome).localeCompare(String(y.condominio_nome), "pt-BR"));

    return NextResponse.json({
      ok: true,
      mes_ref,
      prev_mes_ref: prevMes,
      rows,
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
