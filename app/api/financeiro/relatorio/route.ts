export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type TipoPagamento = "direto" | "boleto";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function parseMesRef(input: string | null): string {
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

function prevMonthISO(mesRef: string): string {
  // mesRef: YYYY-MM-01
  const [y, m] = mesRef.slice(0, 10).split("-").map((x) => Number(x));
  const d = new Date(y, (m ?? 1) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function num(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function pct(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null; // evita infinito; financeiro entende como "sem base"
  return ((now - prev) / prev) * 100;
}

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
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

    // mais seguro: só interno/gestor
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // querystring
    const url = new URL(req.url);
    const mes = parseMesRef(url.searchParams.get("mes")) || currentMonthISO();
    const mesPrev = prevMonthISO(mes);

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

    // mês atual
    const { data: rowsNow, error: errNow } = await supabase
      .from("vw_relatorio_financeiro")
      .select(selectCols)
      .eq("mes_ref", mes)
      .order("condominio_nome", { ascending: true });

    if (errNow) return NextResponse.json({ error: errNow.message }, { status: 400 });

    // mês anterior (pra %)
    const { data: rowsPrev, error: errPrev } = await supabase
      .from("vw_relatorio_financeiro")
      .select("condominio_id,valor_total_pagar")
      .eq("mes_ref", mesPrev);

    if (errPrev) return NextResponse.json({ error: errPrev.message }, { status: 400 });

    const prevMap = new Map<string, number>();
    (rowsPrev ?? []).forEach((r: any) => {
      prevMap.set(String(r.condominio_id), num(r.valor_total_pagar));
    });

    // traz tipo_pagamento do cadastro do condomínio (direto/boleto)
    const condoIds = Array.from(new Set((rowsNow ?? []).map((r: any) => String(r.condominio_id))));
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
      const id = String(r.condominio_id);
      const totalNow = num(r.valor_total_pagar);
      const totalPrev = prevMap.get(id) ?? 0;
      const p = pct(totalNow, totalPrev);

      const tipo_pagamento: TipoPagamento = tipoMap.get(id) ?? "direto";

      return {
        ...r,
        // NOVO (pro frontend)
        tipo_pagamento, // "direto" | "boleto"

        // compat (se algum lugar ainda usa isso)
        pagamento_metodo: tipo_pagamento,

        // mantém o que já existia aqui (não quebra)
        variacao_total_pct: p,
        variacao_total_delta: totalNow - (prevMap.get(id) ?? 0),
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
