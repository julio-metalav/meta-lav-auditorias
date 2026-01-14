export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function prevMonthISO(isoMonth: string) {
  const [y, m] = isoMonth.slice(0, 10).split("-").map((x) => Number(x));
  const d = new Date(y, (m || 1) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function num(v: any) {
  const n = typeof v === "number" ? v : Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pct(curr: number, prev: number) {
  if (!prev) return null; // evita % infinita quando mês anterior = 0
  return ((curr - prev) / prev) * 100;
}

function pickMonthFromRow(r: any) {
  return (
    r?.mes_ref ??
    r?.ano_mes ??
    r?.mes ??
    r?.mes_referencia ??
    r?.competencia ??
    r?.competencia_mes ??
    null
  );
}

function pickCondoId(r: any) {
  return String(r?.condominio_id ?? r?.condo_id ?? r?.ponto_id ?? r?.id_condominio ?? "").trim();
}

function pickCondoNome(r: any) {
  return String(r?.condominio_nome ?? r?.condominio ?? r?.nome_condominio ?? r?.nome ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    // role
    const role = await getUserRole(supabase);
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // params
    const url = new URL(req.url);
    const mes = String(url.searchParams.get("mes") ?? "").trim() || monthISO();
    const mesPrev = prevMonthISO(mes);

    // busca mês atual
    const { data: curRowsRaw, error: curErr } = await (supabase.from("vw_relatorio_financeiro") as any)
      .select("*")
      .or(`mes_ref.eq.${mes},mes.eq.${mes},ano_mes.eq.${mes},competencia.eq.${mes}`)
      .limit(5000);

    if (curErr) return NextResponse.json({ error: curErr.message }, { status: 400 });

    // busca mês anterior
    const { data: prevRowsRaw, error: prevErr } = await (supabase.from("vw_relatorio_financeiro") as any)
      .select("*")
      .or(`mes_ref.eq.${mesPrev},mes.eq.${mesPrev},ano_mes.eq.${mesPrev},competencia.eq.${mesPrev}`)
      .limit(5000);

    if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 400 });

    const curRows: any[] = (curRowsRaw ?? []) as any[];
    const prevRows: any[] = (prevRowsRaw ?? []) as any[];

    // index prev por condominio
    const prevByCondo = new Map<string, any>();
    for (const r of prevRows) {
      const cid = pickCondoId(r);
      if (cid) prevByCondo.set(cid, r);
    }

    const itens = curRows
      .map((r) => {
        const condominio_id = pickCondoId(r);
        const nome = pickCondoNome(r) || "(sem nome)";
        const prev = condominio_id ? prevByCondo.get(condominio_id) : null;

        const cashback = num(r?.valor_cashback);
        const repasse = num(r?.valor_repasse_utilidades)
          || (num(r?.valor_repasse_agua) + num(r?.valor_repasse_energia) + num(r?.valor_repasse_gas));

        const total = cashback + repasse;

        const cashbackPrev = prev ? num(prev?.valor_cashback) : 0;
        const repassePrev = prev
          ? (num(prev?.valor_repasse_utilidades) ||
              (num(prev?.valor_repasse_agua) + num(prev?.valor_repasse_energia) + num(prev?.valor_repasse_gas)))
          : 0;

        const totalPrev = cashbackPrev + repassePrev;

        return {
          condominio_id,
          condominio: nome,

          // banco/pix (vem da view)
          banco_nome: r?.banco_nome ?? null,
          banco_agencia: r?.banco_agencia ?? null,
          banco_conta: r?.banco_conta ?? null,
          banco_pix: r?.banco_pix ?? null,

          cashback,
          repasse,
          total,

          variacao: {
            cashback_percent: pct(cashback, cashbackPrev),
            repasse_percent: pct(repasse, repassePrev),
            total_percent: pct(total, totalPrev),
          },

          // para debug suave se precisar
          mes_ref: pickMonthFromRow(r) ?? mes,
        };
      })
      .sort((a, b) => String(a.condominio).localeCompare(String(b.condominio), "pt-BR"));

    const sum = (key: "cashback" | "repasse" | "total") => itens.reduce((acc, x) => acc + num(x?.[key]), 0);

    return NextResponse.json({
      ok: true,
      mes,
      mes_anterior: mesPrev,
      totais: {
        cashback: sum("cashback"),
        repasse: sum("repasse"),
        total: sum("total"),
      },
      itens,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
