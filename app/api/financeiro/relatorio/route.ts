export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin, getUserAndRole } from "@/lib/auth";

type TipoPagamento = "direto" | "boleto";

type Row = {
  mes_ref: string | null;

  condominio_id: string;
  condominio_nome: string | null;
  cidade: string | null;
  uf: string | null;

  valor_total_pagar: number | null;
  valor_cashback: number | null;
  valor_repasse_utilidades: number | null;

  pct_valor_total_pagar?: number | null;
  pct_valor_cashback?: number | null;
  pct_valor_repasse_utilidades?: number | null;

  banco_pix: string | null;
  banco_nome: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;

  tipo_pagamento?: TipoPagamento | null;

  status: string | null;
  auditoria_id: string | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function addMonths(iso: string, delta: number) {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  return monthISO(d);
}

function n(v: any): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function pct(now: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

export async function GET(req: Request) {
  try {
    const ctx = await getUserAndRole();
    if (!ctx.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (!ctx.role || (ctx.role !== "interno" && ctx.role !== "gestor")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const url = new URL(req.url);
    const mesParam = (url.searchParams.get("mes") || monthISO()).trim();

    if (!/^\d{4}-\d{2}-01$/.test(mesParam)) {
      return NextResponse.json({ error: "Parâmetro mes inválido. Use YYYY-MM-01" }, { status: 400 });
    }

    // REGRA DO NEGÓCIO:
    // a tela mostra o "mês corrente" (ex: Jan/2026), mas o relatório financeiro é do MÊS ANTERIOR (ex: Dez/2025)
    const competenciaMes = mesParam;
    const mesRefRelatorio = addMonths(competenciaMes, -1);
    const mesRefPrev = addMonths(competenciaMes, -2);

    const admin = supabaseAdmin();

    // 1) Busca principal pela view (quando existir)
    const { data: rowsNowRaw, error: eNow } = await (admin.from("vw_relatorio_financeiro") as any)
      .select(
        [
          "mes_ref",
          "condominio_id",
          "condominio_nome",
          "cidade",
          "uf",
          "valor_total_pagar",
          "valor_cashback",
          "valor_repasse_utilidades",
          "banco_pix",
          "banco_nome",
          "banco_agencia",
          "banco_conta",
          "tipo_pagamento",
          "status",
          "auditoria_id",
        ].join(",")
      )
      .eq("mes_ref", mesRefRelatorio);

    if (eNow) return NextResponse.json({ error: eNow.message }, { status: 400 });

    let rowsNow: Row[] = (rowsNowRaw ?? []) as Row[];

    // 1b) Fallback: se a view vier vazia, ainda assim mostramos os condomínios do mês (com zeros),
    // para não ficar "tela vazia" enquanto ciclos ainda não foram lançados/fechados.
    if (!rowsNow.length) {
      const { data: auds, error: eAuds } = await (admin.from("auditorias") as any)
        .select(
          [
            "id",
            "status",
            "condominio_id",
            "mes_ref",
            "condominios!inner(id,nome,cidade,uf,banco_pix,banco_nome,banco_agencia,banco_conta,tipo_pagamento)",
          ].join(",")
        )
        .eq("mes_ref", mesRefRelatorio);

      if (eAuds) return NextResponse.json({ error: eAuds.message }, { status: 400 });

      rowsNow =
        (auds ?? []).map((a: any) => ({
          mes_ref: a.mes_ref ?? mesRefRelatorio,
          condominio_id: a.condominio_id,
          condominio_nome: a.condominios?.nome ?? null,
          cidade: a.condominios?.cidade ?? null,
          uf: a.condominios?.uf ?? null,
          valor_total_pagar: 0,
          valor_cashback: 0,
          valor_repasse_utilidades: 0,
          banco_pix: a.condominios?.banco_pix ?? null,
          banco_nome: a.condominios?.banco_nome ?? null,
          banco_agencia: a.condominios?.banco_agencia ?? null,
          banco_conta: a.condominios?.banco_conta ?? null,
          tipo_pagamento: (a.condominios?.tipo_pagamento ?? null) as any,
          status: a.status ?? null,
          auditoria_id: a.id ?? null,
        })) as Row[];
    }

    // 2) Mês anterior (para %)
    const { data: rowsPrevRaw, error: ePrev } = await (admin.from("vw_relatorio_financeiro") as any)
      .select("condominio_id,valor_total_pagar,valor_cashback,valor_repasse_utilidades")
      .eq("mes_ref", mesRefPrev);

    if (ePrev) return NextResponse.json({ error: ePrev.message }, { status: 400 });

    const prevByCondo = new Map<string, any>();
    for (const r of (rowsPrevRaw ?? []) as any[]) prevByCondo.set(r.condominio_id, r);

    // 3) Enriquecimento % por condomínio
    rowsNow = rowsNow.map((r) => {
      const prev = prevByCondo.get(r.condominio_id);
      const nowTot = n(r.valor_total_pagar);
      const nowCb = n(r.valor_cashback);
      const nowRep = n(r.valor_repasse_utilidades);

      const prevTot = n(prev?.valor_total_pagar);
      const prevCb = n(prev?.valor_cashback);
      const prevRep = n(prev?.valor_repasse_utilidades);

      return {
        ...r,
        pct_valor_total_pagar: pct(nowTot, prevTot),
        pct_valor_cashback: pct(nowCb, prevCb),
        pct_valor_repasse_utilidades: pct(nowRep, prevRep),
      };
    });

    // 4) Totais
    const totalsNow = rowsNow.reduce(
      (acc, r) => {
        acc.valor_cashback += n(r.valor_cashback);
        acc.valor_repasse_utilidades += n(r.valor_repasse_utilidades);
        acc.valor_total_pagar += n(r.valor_total_pagar);
        return acc;
      },
      { valor_cashback: 0, valor_repasse_utilidades: 0, valor_total_pagar: 0 }
    );

    const totalsPrev = ((rowsPrevRaw ?? []) as any[]).reduce(
      (acc, r) => {
        acc.valor_cashback += n(r.valor_cashback);
        acc.valor_repasse_utilidades += n(r.valor_repasse_utilidades);
        acc.valor_total_pagar += n(r.valor_total_pagar);
        return acc;
      },
      { valor_cashback: 0, valor_repasse_utilidades: 0, valor_total_pagar: 0 }
    );

    const totals = {
      now: totalsNow,
      pct: {
        valor_cashback: pct(totalsNow.valor_cashback, totalsPrev.valor_cashback),
        valor_repasse_utilidades: pct(totalsNow.valor_repasse_utilidades, totalsPrev.valor_repasse_utilidades),
        valor_total_pagar: pct(totalsNow.valor_total_pagar, totalsPrev.valor_total_pagar),
      },
    };

    return NextResponse.json({
      ok: true,
      competencia_mes_ref: competenciaMes, // o mês que o usuário está "selecionando" na UI
      mes_ref: mesRefRelatorio, // o mês REAL do relatório (mês anterior)
      mes_ref_prev: mesRefPrev,
      rows: rowsNow,
      totals,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
