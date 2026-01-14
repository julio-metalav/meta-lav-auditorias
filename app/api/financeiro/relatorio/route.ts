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

function parseMesRef(input: string | null): string {
  // esperado: YYYY-MM-01 (ex: 2026-01-01)
  // se vier YYYY-MM, normaliza pra YYYY-MM-01
  if (!input) return "";
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return s;
}

function currentMonthISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function prevMonthISO(iso: string): string {
  // iso: YYYY-MM-01
  const s = String(iso || "").slice(0, 10);
  const [yy, mm] = s.split("-").map((x) => Number(x));
  if (!yy || !mm) return currentMonthISO();
  const d = new Date(yy, mm - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toNum(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pct(now: number, prev: number): number | null {
  if (!prev) return null;
  return ((now - prev) / prev) * 100;
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getUserRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role" }, { status: 403 });

    // segurança: relatório só para interno/gestor
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // querystring
    const url = new URL(req.url);
    const mes_ref = parseMesRef(url.searchParams.get("mes")) || currentMonthISO();
    const mes_ref_prev = prevMonthISO(mes_ref);

    const selectCols = [
      "mes_ref",
      "condominio_id",
      "condominio_nome",
      "cidade",
      "uf",
      "valor_total_pagar",
      "valor_cashback",
      "valor_repasse_utilidades",
      "valor_repasse_agua",
      "valor_repasse_energia",
      "valor_repasse_gas",
      "favorecido_nome",
      "banco_nome",
      "banco_agencia",
      "banco_conta",
      "banco_pix",
      "status",
      "auditoria_id",
    ].join(",");

    // 1) mês atual
    const { data: cur, error: curErr } = await supabase
      .from("vw_relatorio_financeiro")
      .select(selectCols)
      .eq("mes_ref", mes_ref)
      .order("condominio_nome", { ascending: true });

    if (curErr) return NextResponse.json({ error: curErr.message }, { status: 400 });

    // 2) mês anterior
    const { data: prev, error: prevErr } = await supabase
      .from("vw_relatorio_financeiro")
      .select(selectCols)
      .eq("mes_ref", mes_ref_prev)
      .order("condominio_nome", { ascending: true });

    if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 400 });

    const prevMap = new Map<string, any>();
    (prev ?? []).forEach((r: any) => {
      const key = String(r?.condominio_id ?? "").trim();
      if (key) prevMap.set(key, r);
    });

    const rows = (cur ?? []).map((r: any) => {
      const key = String(r?.condominio_id ?? "").trim();
      const p = key ? prevMap.get(key) : null;

      const nowTotal = toNum(r?.valor_total_pagar);
      const prevTotal = toNum(p?.valor_total_pagar);

      const nowCb = toNum(r?.valor_cashback);
      const prevCb = toNum(p?.valor_cashback);

      const nowRep = toNum(r?.valor_repasse_utilidades);
      const prevRep = toNum(p?.valor_repasse_utilidades);

      return {
        ...r,

        prev_valor_total_pagar: prevTotal,
        delta_valor_total_pagar: nowTotal - prevTotal,
        pct_valor_total_pagar: pct(nowTotal, prevTotal),

        prev_valor_cashback: prevCb,
        delta_valor_cashback: nowCb - prevCb,
        pct_valor_cashback: pct(nowCb, prevCb),

        prev_valor_repasse_utilidades: prevRep,
        delta_valor_repasse_utilidades: nowRep - prevRep,
        pct_valor_repasse_utilidades: pct(nowRep, prevRep),
      };
    });

    // Totais (cards)
    const sum = (arr: any[], key: string) => arr.reduce((acc, x) => acc + toNum(x?.[key]), 0);

    const total_now = {
      valor_cashback: sum(rows, "valor_cashback"),
      valor_repasse_utilidades: sum(rows, "valor_repasse_utilidades"),
      valor_total_pagar: sum(rows, "valor_total_pagar"),
    };

    const total_prev = {
      valor_cashback: sum(prev ?? [], "valor_cashback"),
      valor_repasse_utilidades: sum(prev ?? [], "valor_repasse_utilidades"),
      valor_total_pagar: sum(prev ?? [], "valor_total_pagar"),
    };

    const total_delta = {
      valor_cashback: total_now.valor_cashback - total_prev.valor_cashback,
      valor_repasse_utilidades: total_now.valor_repasse_utilidades - total_prev.valor_repasse_utilidades,
      valor_total_pagar: total_now.valor_total_pagar - total_prev.valor_total_pagar,
    };

    const total_pct = {
      valor_cashback: pct(total_now.valor_cashback, total_prev.valor_cashback),
      valor_repasse_utilidades: pct(total_now.valor_repasse_utilidades, total_prev.valor_repasse_utilidades),
      valor_total_pagar: pct(total_now.valor_total_pagar, total_prev.valor_total_pagar),
    };

    return NextResponse.json({
      ok: true,
      mes_ref,
      mes_ref_prev,
      totals: { now: total_now, prev: total_prev, delta: total_delta, pct: total_pct },
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
