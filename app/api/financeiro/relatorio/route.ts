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

export async function GET(req: Request) {
  try {
    const supabase = supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getUserRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role" }, { status: 403 });

    // (RLS) aqui você pode escolher:
    // - liberar para interno/gestor apenas
    // - ou liberar também para auditor
    // Vou deixar para interno/gestor (mais seguro).
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // querystring
    const url = new URL(req.url);
    const mes = parseMesRef(url.searchParams.get("mes")) || currentMonthISO();

    // IMPORTANTE: coluna é mes_ref (não mes)
    const { data, error } = await supabase
      .from("vw_relatorio_financeiro")
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
        ].join(",")
      )
      .eq("mes_ref", mes)
      .order("condominio_nome", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      mes_ref: mes,
      rows: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
