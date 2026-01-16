export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type TipoPagamento = "direto" | "boleto";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeMoney(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

function normalizeCategoria(v: any): "lavadora" | "secadora" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "secadora" ? "secadora" : "lavadora";
}

function labelMaquina(cat: any, capacidadeKg: any) {
  const c = normalizeCategoria(cat);
  const cap = safeNum(capacidadeKg);
  const tipo = c === "lavadora" ? "Lavadora" : "Secadora";
  return cap != null ? `${tipo} ${cap}kg` : tipo;
}

function fmtCompetencia(iso: any) {
  const s = String(iso ?? "").slice(0, 10);
  const y = s.slice(0, 4);
  const m = s.slice(5, 7);
  if (y.length === 4 && m.length === 2) return `${m}/${y}`;
  return s;
}

function getLeituraAtual(aud: any, kind: "agua" | "energia" | "gas") {
  if (kind === "agua") return safeNum(aud?.agua_leitura) ?? safeNum(aud?.leitura_agua);
  if (kind === "energia") return safeNum(aud?.energia_leitura) ?? safeNum(aud?.leitura_energia);
  return safeNum(aud?.gas_leitura) ?? safeNum(aud?.leitura_gas);
}

function getLeituraBase(aud: any, kind: "agua" | "energia" | "gas") {
  if (kind === "agua") {
    return safeNum(aud?.agua_leitura_base) ?? safeNum(aud?.agua_base) ?? safeNum(aud?.base_agua);
  }
  if (kind === "energia") {
    return safeNum(aud?.energia_leitura_base) ?? safeNum(aud?.energia_base) ?? safeNum(aud?.base_energia);
  }
  return safeNum(aud?.gas_leitura_base) ?? safeNum(aud?.gas_base) ?? safeNum(aud?.base_gas);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);

    const r = (role ?? "auditor") as Role;
    if (!roleGte(r, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = String(params?.id ?? "").trim();
    if (!auditoriaId) return bad("ID da auditoria ausente.", 400);

    const admin = supabaseAdmin();

    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select(
        [
          "id",
          "condominio_id",
          "mes_ref",
          "status",
          "agua_leitura",
          "energia_leitura",
          "gas_leitura",
          "leitura_agua",
          "leitura_energia",
          "leitura_gas",
          "agua_leitura_base",
          "energia_leitura_base",
          "gas_leitura_base",
          "agua_base",
          "energia_base",
          "gas_base",
          "base_agua",
          "base_energia",
          "base_gas",
          "fechamento_obs",
          "foto_agua_url",
          "foto_energia_url",
          "foto_gas_url",
          "comprovante_fechamento_url",
        ].join(",")
      )
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada.", 404);

    const status = String((aud as any)?.status ?? "").trim().toLowerCase();
    if (status !== "final") return bad("Auditoria não finalizada (status precisa ser 'final').", 400);

    const condominioId = String((aud as any)?.condominio_id ?? "").trim();
    if (!condominioId) return bad("Auditoria sem condominio_id.", 400);

    const { data: condo, error: condoErr } = await admin
      .from("condominios")
      .select("id,nome,cashback_percent,tipo_pagamento,agua_valor_m3,energia_valor_kwh,gas_valor_m3")
      .eq("id", condominioId)
      .maybeSingle();

    if (condoErr) return bad(condoErr.message, 500);
    if (!condo) return bad("Condomínio não encontrado.", 404);

    // ✅ Reusa /ciclos pra NÃO duplicar cálculo
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";
    const ciclosRes = await fetch(`${origin}/api/auditorias/${auditoriaId}/ciclos`, {
      method: "GET",
      headers: { cookie },
      cache: "no-store",
    });

    const ciclosJson = await ciclosRes.json().catch(() => null);
    if (!ciclosRes.ok) return bad(ciclosJson?.error ?? "Falha ao obter ciclos.", ciclosRes.status || 400);

    const ciclosData = ciclosJson?.data ?? {};
    const itens = Array.isArray(ciclosData?.itens) ? ciclosData.itens : [];
    const totais = ciclosData?.totais ?? {};

    const vendasItens = itens.map((it: any) => {
      const ciclos = safeMoney(it?.ciclos);
      const valor = safeMoney(it?.valor_ciclo);
      const cat = normalizeCategoria(it?.categoria);
      const tipo = cat === "lavadora" ? "Lavadora" : "Secadora";
      return {
        maquina: labelMaquina(cat, it?.capacidade_kg),
        tipo,
        ciclos,
        valor_unitario: valor,
        receita: ciclos * valor,
      };
    });

    const cashbackPercent = safeMoney((condo as any)?.cashback_percent);

    // Leituras e consumos (consumo vem do /ciclos para manter consistência)
    const aguaBase = getLeituraBase(aud, "agua");
    const aguaAtual = getLeituraAtual(aud, "agua");
    const energiaBase = getLeituraBase(aud, "energia");
    const energiaAtual = getLeituraAtual(aud, "energia");
    const gasBase = getLeituraBase(aud, "gas");
    const gasAtual = getLeituraAtual(aud, "gas");

    const consumoAgua = safeMoney(totais?.consumo_agua);
    const consumoEnergia = safeMoney(totais?.consumo_energia);
    const consumoGas = safeMoney(totais?.consumo_gas);

    const aguaValorM3 = safeMoney((condo as any)?.agua_valor_m3);
    const energiaValorKwh = safeMoney((condo as any)?.energia_valor_kwh);
    const gasValorM3 = safeMoney((condo as any)?.gas_valor_m3);

    const consumoItens: any[] = [
      { insumo: "Água", leitura_anterior: aguaBase, leitura_atual: aguaAtual, consumo: consumoAgua, valor_total: consumoAgua * aguaValorM3 },
      { insumo: "Energia", leitura_anterior: energiaBase, leitura_atual: energiaAtual, consumo: consumoEnergia, valor_total: consumoEnergia * energiaValorKwh },
    ];

    const temGas = gasValorM3 > 0 || gasBase != null || gasAtual != null || consumoGas > 0;
    if (temGas) {
      consumoItens.push({
        insumo: "Gás",
        leitura_anterior: gasBase,
        leitura_atual: gasAtual,
        consumo: consumoGas,
        valor_total: consumoGas * gasValorM3,
      });
    }

    const tipoPagamento = normalizeTipoPagamento((condo as any)?.tipo_pagamento);
    const comprovante = tipoPagamento === "direto" ? (aud as any)?.comprovante_fechamento_url ?? null : null;

    const dto = {
      meta: {
        auditoria_id: auditoriaId,
        condominio_id: condominioId,
        condominio_nome: String((condo as any)?.nome ?? "").trim(),
        competencia: fmtCompetencia((aud as any)?.mes_ref),
        mes_ref: (aud as any)?.mes_ref ?? null,
        gerado_em: new Date().toISOString(),
      },

      vendas_por_maquina: {
        itens: vendasItens,
        receita_bruta_total: safeMoney(totais?.receita_bruta),
        cashback_percent: cashbackPercent,
        valor_cashback: safeMoney(totais?.total_cashback),
      },

      consumo_insumos: {
        itens: consumoItens,
        total_repasse_consumo: safeMoney(totais?.total_repasse),
      },

      totalizacao_final: {
        cashback: safeMoney(totais?.total_cashback),
        repasse_consumo: safeMoney(totais?.total_repasse),
        total_a_pagar_condominio: safeMoney(totais?.total_a_pagar),
      },

      observacoes: (aud as any)?.fechamento_obs ?? null,

      anexos: {
        foto_agua_url: (aud as any)?.foto_agua_url ?? null,
        foto_energia_url: (aud as any)?.foto_energia_url ?? null,
        foto_gas_url: (aud as any)?.foto_gas_url ?? null,
        comprovante_fechamento_url: comprovante,
      },
    };

    return NextResponse.json({ ok: true, data: dto });
  } catch (e: any) {
    const msg = e?.message ?? "Erro inesperado";
    if (msg === "NOT_AUTHENTICATED") return bad("Não autenticado", 401);
    return bad(msg, 500);
  }
}
