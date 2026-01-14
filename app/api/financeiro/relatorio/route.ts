export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

function toIsoMonthStart(input: string) {
  // espera YYYY-MM-01 (ou qualquer YYYY-MM-DD) e normaliza para YYYY-MM-01
  const s = String(input ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split("-").map((x) => Number(x));
  if (!y || !m) return null;
  const mm = String(m).padStart(2, "0");
  return `${y}-${mm}-01`;
}

function prevMonth(yyyyMm01: string) {
  const [y, m] = yyyyMm01.split("-").map((x) => Number(x));
  const d = new Date(y, (m ?? 1) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function toNumber(v: any) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pctVar(curr: number, prev: number) {
  // se prev = 0, não dá % “honesta”
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function pickId(row: any) {
  return (
    row?.condominio_id ??
    row?.condominioId ??
    row?.condominio ??
    row?.condominio_uuid ??
    row?.condo_id ??
    null
  );
}

function pickMes(row: any) {
  return row?.mes_ref ?? row?.ano_mes ?? row?.mes ?? row?.competencia ?? null;
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseServer();

    // auth + role
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const role = await getRole(supabase);
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Apenas interno/gestor." }, { status: 403 });
    }

    // params
    const url = new URL(req.url);
    const mesParam = url.searchParams.get("mes") ?? "";
    const mes = toIsoMonthStart(mesParam);
    if (!mes) {
      return NextResponse.json({ error: 'Parâmetro "mes" inválido. Use YYYY-MM-01.' }, { status: 400 });
    }
    const mesPrev = prevMonth(mes);

    // 1) pega o mês atual na view
    const { data: rowsNow, error: errNow } = await (supabase.from("vw_relatorio_financeiro") as any)
      .select("*")
      .eq("mes_ref", mes)
      .limit(5000);

    // fallback se a view usa outro nome de coluna (ano_mes)
    let now = rowsNow as any[] | null;
    if ((errNow || !now) && String(errNow?.message ?? "").toLowerCase().includes("column")) {
      const alt = await (supabase.from("vw_relatorio_financeiro") as any).select("*").eq("ano_mes", mes).limit(5000);
      if (alt.error) return NextResponse.json({ error: alt.error.message }, { status: 400 });
      now = alt.data as any[];
    } else if (errNow) {
      return NextResponse.json({ error: errNow.message }, { status: 400 });
    }

    // 2) pega o mês anterior na view
    const { data: rowsPrev, error: errPrev } = await (supabase.from("vw_relatorio_financeiro") as any)
      .select("*")
      .eq("mes_ref", mesPrev)
      .limit(5000);

    let prev = rowsPrev as any[] | null;
    if ((errPrev || !prev) && String(errPrev?.message ?? "").toLowerCase().includes("column")) {
      const alt = await (supabase.from("vw_relatorio_financeiro") as any).select("*").eq("ano_mes", mesPrev).limit(5000);
      if (alt.error) return NextResponse.json({ error: alt.error.message }, { status: 400 });
      prev = alt.data as any[];
    } else if (errPrev) {
      return NextResponse.json({ error: errPrev.message }, { status: 400 });
    }

    const nowList = (now ?? []) as any[];
    const prevList = (prev ?? []) as any[];

    // 3) mapa do mês anterior por condomínio
    const prevByCondo = new Map<string, any>();
    for (const r of prevList) {
      const cid = pickId(r);
      if (!cid) continue;
      prevByCondo.set(String(cid), r);
    }

    // 4) buscar dados do condomínio (nome/cidade/UF + PIX/banco) pra compor o relatório sintético
    const condoIds = Array.from(
      new Set(nowList.map((r) => String(pickId(r) ?? "")).filter((x) => x && x !== "null" && x !== "undefined"))
    );

    const condosById = new Map<string, any>();
    if (condoIds.length) {
      const { data: condos, error: condosErr } = await (supabase.from("condominios") as any)
        .select("id,nome,cidade,uf,pix,banco_pix,banco_nome,banco_agencia,banco_conta")
        .in("id", condoIds);

      if (condosErr) return NextResponse.json({ error: condosErr.message }, { status: 400 });
      for (const c of condos ?? []) condosById.set(String(c.id), c);
    }

    // 5) monta itens
    const itens = nowList.map((r) => {
      const cid = String(pickId(r) ?? "");
      const rPrev = prevByCondo.get(cid) ?? null;
      const c = condosById.get(cid) ?? null;

      const cashback = toNumber(r?.valor_cashback);
      const repasse =
        r?.valor_repasse_utilidades !== undefined && r?.valor_repasse_utilidades !== null
          ? toNumber(r.valor_repasse_utilidades)
          : toNumber(r?.valor_repasse_agua) + toNumber(r?.valor_repasse_energia) + toNumber(r?.valor_repasse_gas);

      const cashbackPrev = rPrev ? toNumber(rPrev?.valor_cashback) : 0;
      const repassePrev =
        rPrev && (rPrev?.valor_repasse_utilidades !== undefined && rPrev?.valor_repasse_utilidades !== null)
          ? toNumber(rPrev.valor_repasse_utilidades)
          : rPrev
          ? toNumber(rPrev?.valor_repasse_agua) + toNumber(rPrev?.valor_repasse_energia) + toNumber(rPrev?.valor_repasse_gas)
          : 0;

      const total = cashback + repasse;

      return {
        mes: pickMes(r) ?? mes,
        condominio_id: cid || null,

        condominio: c?.nome ?? r?.condominio_nome ?? r?.condominio ?? null,
        cidade: c?.cidade ?? r?.cidade ?? null,
        uf: c?.uf ?? r?.uf ?? null,

        // valores
        cashback,
        cashback_prev: cashbackPrev,
        cashback_var_pct: pctVar(cashback, cashbackPrev),

        repasse,
        repasse_prev: repassePrev,
        repasse_var_pct: pctVar(repasse, repassePrev),

        total_pagar: total,

        // dados bancários/PIX (preferir cadastro do condomínio)
        pix: c?.pix ?? c?.banco_pix ?? r?.pix ?? r?.banco_pix ?? null,
        banco_nome: c?.banco_nome ?? r?.banco_nome ?? null,
        banco_agencia: c?.banco_agencia ?? r?.banco_agencia ?? null,
        banco_conta: c?.banco_conta ?? r?.banco_conta ?? null,

        // obs do financeiro (você disse: opcional; por enquanto vem do que existir)
        obs: r?.fechamento_obs ?? r?.obs ?? null,
      };
    });

    // 6) totais
    const totais = itens.reduce(
      (acc, it) => {
        acc.cashback += toNumber(it.cashback);
        acc.repasse += toNumber(it.repasse);
        acc.total_pagar += toNumber(it.total_pagar);
        return acc;
      },
      { cashback: 0, repasse: 0, total_pagar: 0 }
    );

    return NextResponse.json({
      ok: true,
      mes,
      mes_anterior: mesPrev,
      itens,
      totais,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
