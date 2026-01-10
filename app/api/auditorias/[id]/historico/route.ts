export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (prof?.role ?? null) as Role | null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // garante que auditoria existe
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });
    }

    // logs: usa os nomes REAIS das colunas que você criou
    const { data: logs, error: logErr } = await supabase
      .from("auditoria_status_logs")
      .select(
        `
        id,
        auditoria_id,
        de_status,
        para_status,
        user_id,
        created_at
      `
      )
      .eq("auditoria_id", auditoriaId)
      .order("created_at", { ascending: false });

    if (logErr) {
      return NextResponse.json({ error: logErr.message }, { status: 400 });
    }

    const role = await getUserRole(supabase);

    return NextResponse.json({ ok: true, role, data: logs ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
