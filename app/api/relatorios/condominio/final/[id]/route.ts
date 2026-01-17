export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type TipoPagamento = "direto" | "boleto";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function m(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function tipoPagamento(v: any): TipoPagamento {
  return String(v).toLowerCase() === "boleto" ? "boleto" : "direto";
}

function categoria(v: any) {
  return String(v).toLowerCase() === "secadora" ? "Secadora" : "Lavadora";
}

function maquinaLabel(cat: any, kg: any) {
  const cap = n(kg);
  return cap ? `${categoria(cat)} ${cap}kg` : categoria(cat);
}

function competencia(iso: any) {
  const s = String(iso ?? "").slice(0, 10);
  return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = params.id;
  const admin = supabaseAdmin();

  const { data: aud, error } = await admin
    .from("auditorias")
    .select(
      `
      id,
      condominio_id,
      mes_ref,
      status,
      agua_leitura,
      energia_leitura,
      gas_leitura,
      agua_leitura_base,
      energia_leitura_base,
      gas_leitura_base,
      fechamento_obs,
      foto_agua_url,
      foto_energia_url,
      foto_gas_url,
      comprovante_fechamento_url
    `
    )
    .eq("id", auditoriaId)
    .maybeSingle();

  if (error) return bad(error.message, 500);
  if (!aud) return bad("Auditoria não encontrada", 404);
  if (aud.status !== "final") return bad("Auditoria não finalizada");

  const { data: condo, error: condoErr } = await admin
    .from("condominios")
    .select("id,nome,cashback_percent,tipo_pagamento,agua_valor_m3,energia_valor_kwh,gas_valor_m3")
    .eq("id", aud.condominio_id)
    .maybeSingle();

  if (condoErr) return bad(condoErr.message, 500);
  if (!condo) return bad("Condomínio não encontrado", 404);

  // chama a rota existente de ciclos
  const origin = new URL((globalThis as any).location?.href ?? "http://localhost").origin;

  const ciclosRes = await fetch(`${origin}/api/auditorias/${auditoriaId}/ciclos`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const ciclosJson = await ciclosRes.json().catch(() => null);
  if (!ciclosRes.ok) return bad(ciclosJson?.error ?? "Falha ao obter ciclos", 500);

  const ciclos = ciclosJson?.data ?? ciclosJson; // compat

  const vendas = (ciclos?.itens ?? []).map((i: any) => ({
    maquina: maquinaLabel(i.categoria, i.capacidade_kg),
    ciclos: m(i.ciclos),
    valor_unitario: m(i.valor_ciclo),
    valor_total: m(i.ciclos) * m(i.valor_ciclo),
  }));

  const aguaUnit = m(condo.agua_valor_m3);
  const energiaUnit = m(condo.energia_valor_kwh);
  const gasUnit = m(condo.gas_valor_m3);

  const consumo: any[] = [
    {
      insumo: "Água",
      leitura_anterior: n(aud.agua_leitura_base),
      leitura_atual: n(aud.agua_leitura),
      consumo: m(ciclos?.totais?.consumo_agua),
      valor_unitario: aguaUnit,
      valor_total: m(ciclos?.totais?.consumo_agua) * aguaUnit,
    },
    {
      insumo: "Energia",
      leitura_anterior: n(aud.energia_leitura_base),
      leitura_atual: n(aud.energia_leitura),
      consumo: m(ciclos?.totais?.consumo_energia),
      valor_unitario: energiaUnit,
      valor_total: m(ciclos?.totais?.consumo_energia) * energiaUnit,
    },
  ];

  // ✅ gás entra se existir "valor de gás" cadastrado no condomínio
  if (gasUnit > 0) {
    consumo.push({
      insumo: "Gás",
      leitura_anterior: n(aud.gas_leitura_base),
      leitura_atual: n(aud.gas_leitura),
      consumo: m(ciclos?.totais?.consumo_gas),
      valor_unitario: gasUnit,
      valor_total: m(ciclos?.totais?.consumo_gas) * gasUnit,
    });
  }

  const receitaBruta = m(ciclos?.totais?.receita_bruta);
  const cashbackPercent = m(condo.cashback_percent);
  const totalCashback = m(ciclos?.totais?.total_cashback);
  const totalRepasse = m(ciclos?.totais?.total_repasse);
  const totalAPagar = m(ciclos?.totais?.total_a_pagar);

  return NextResponse.json({
    ok: true,
    data: {
      meta: {
        auditoria_id: auditoriaId,
        condominio_nome: condo.nome,
        competencia: competencia(aud.mes_ref),
        gerado_em: new Date().toISOString(),
      },

      vendas_por_maquina: {
        itens: vendas,
        receita_bruta_total: receitaBruta,
        cashback_percent: cashbackPercent,
        valor_cashback: totalCashback,
      },

      consumo_insumos: {
        itens: consumo,
        total_repasse_consumo: totalRepasse,
      },

      totalizacao_final: {
        cashback: totalCashback,
        repasse_consumo: totalRepasse,
        total_a_pagar_condominio: totalAPagar,
      },

      observacoes: aud.fechamento_obs,

      anexos: {
        foto_agua_url: aud.foto_agua_url,
        foto_energia_url: aud.foto_energia_url,
        foto_gas_url: gasUnit > 0 ? aud.foto_gas_url : null,
        comprovante_fechamento_url:
          tipoPagamento(condo.tipo_pagamento) === "direto"
            ? aud.comprovante_fechamento_url
            : null,
      },
    },
  });
}
