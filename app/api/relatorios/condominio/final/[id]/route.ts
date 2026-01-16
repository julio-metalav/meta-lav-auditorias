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
    .select(`
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
    `)
    .eq("id", auditoriaId)
    .maybeSingle();

  if (error) return bad(error.message, 500);
  if (!aud) return bad("Auditoria não encontrada", 404);
  if (aud.status !== "final") return bad("Auditoria não finalizada");

  const { data: condo } = await admin
    .from("condominios")
    .select("id,nome,cashback_percent,tipo_pagamento,agua_valor_m3,energia_valor_kwh,gas_valor_m3")
    .eq("id", aud.condominio_id)
    .maybeSingle();

  const ciclosRes = await fetch(
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/auditorias/${auditoriaId}/ciclos`,
    { cache: "no-store", headers: { cookie: "" } }
  );
  const { data: ciclos } = await ciclosRes.json();

  const vendas = ciclos.itens.map((i: any) => ({
    maquina: maquinaLabel(i.categoria, i.capacidade_kg),
    tipo: categoria(i.categoria),
    ciclos: m(i.ciclos),
    valor_unitario: m(i.valor_ciclo),
    receita: m(i.ciclos) * m(i.valor_ciclo),
  }));

  const consumo = [
    {
      insumo: "Água",
      leitura_anterior: n(aud.agua_leitura_base),
      leitura_atual: n(aud.agua_leitura),
      consumo: m(ciclos.totais.consumo_agua),
      valor_total: m(ciclos.totais.consumo_agua) * m(condo.agua_valor_m3),
    },
    {
      insumo: "Energia",
      leitura_anterior: n(aud.energia_leitura_base),
      leitura_atual: n(aud.energia_leitura),
      consumo: m(ciclos.totais.consumo_energia),
      valor_total: m(ciclos.totais.consumo_energia) * m(condo.energia_valor_kwh),
    },
  ];

  if (m(ciclos.totais.consumo_gas) > 0) {
    consumo.push({
      insumo: "Gás",
      leitura_anterior: n(aud.gas_leitura_base),
      leitura_atual: n(aud.gas_leitura),
      consumo: m(ciclos.totais.consumo_gas),
      valor_total: m(ciclos.totais.consumo_gas) * m(condo.gas_valor_m3),
    });
  }

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
        receita_bruta_total: m(ciclos.totais.receita_bruta),
        cashback_percent: m(condo.cashback_percent),
        valor_cashback: m(ciclos.totais.total_cashback),
      },
      consumo_insumos: {
        itens: consumo,
        total_repasse_consumo: m(ciclos.totais.total_repasse),
      },
      totalizacao_final: {
        cashback: m(ciclos.totais.total_cashback),
        repasse_consumo: m(ciclos.totais.total_repasse),
        total_a_pagar_condominio: m(ciclos.totais.total_a_pagar),
      },
      observacoes: aud.fechamento_obs,
      anexos: {
        foto_agua_url: aud.foto_agua_url,
        foto_energia_url: aud.foto_energia_url,
        foto_gas_url: aud.foto_gas_url,
        comprovante_fechamento_url:
          tipoPagamento(condo.tipo_pagamento) === "direto"
            ? aud.comprovante_fechamento_url
            : null,
      },
    },
  });
}
