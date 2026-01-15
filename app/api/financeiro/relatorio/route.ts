export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type TipoPagamento = "direto" | "boleto";

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "boleto") return "boleto";
  return "direto";
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function addMonths(iso: string, delta: number) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + delta);
  return monthISO(d);
}

async function getMeRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseServer();

    // auth + role
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getMeRole(supabase);
    if (!roleGte(role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const url = new URL(req.url);
    const mes = url.searchParams.get("mes_ref") ?? monthISO(new Date());
    const mesPrev = addMonths(mes, -1);

    // ⚠️ IMPORTANTE: não pedir tipo_pagamento da VIEW (ela não tem essa coluna)
    const selectCols = [
      "condominio_id",
      "condominio_nome",
      "cidade",
      "uf",
      "mes_ref",
      "auditoria_id",
      "status",
      "valor_cashback",
      "valor_repasse_utilidades",
      "valor_total_pagar",
      "banco_nome",
      "banco_agencia",
      "banco_conta",
      "banco_pix",
    ].join(",");

    const { data: rowsNow, error: errNow } = await (supabase.from("vw_relatorio_financeiro") as any)
      .select(selectCols)
      .eq("mes_ref", mesPrev);

    if (errNow) return NextResponse.json({ error: errNow.message }, { status: 400 });

    // pega tipo_pagamento direto da tabela condominios
    const condoIds = Array.from(new Set((rowsNow ?? []).map((r: any) => String(r.condominio_id)).filter(Boolean)));

    const tipoMap = new Map<string, TipoPagamento>();
    if (condoIds.length > 0) {
      const { data: condos, error: errCondo } = await (supabase.from("condominios") as any)
        .select("id,tipo_pagamento")
        .in("id", condoIds);

      if (errCondo) return NextResponse.json({ error: errCondo.message }, { status: 400 });

      (condos ?? []).forEach((c: any) => {
        tipoMap.set(String(c.id), normalizeTipoPagamento(c?.tipo_pagamento));
      });
    }

    const out = (rowsNow ?? []).map((r: any) => {
      const cid = String(r.condominio_id);
      const tipo = tipoMap.get(cid) ?? "direto";

      return {
        ...r,
        tipo_pagamento: tipo,
        mes_ref_prev: mesPrev,
      };
    });

    return NextResponse.json({
      ok: true,
      mes_ref: mes,
      mes_ref_prev: mesPrev,
      rows: out,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
