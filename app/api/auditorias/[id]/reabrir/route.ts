export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(): Promise<{ userId: string; role: Role | null } | null> {
  const supabase = supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profErr) return { userId: auth.user.id, role: null };

  return { userId: auth.user.id, role: (prof?.role ?? null) as Role | null };
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const gate = await getUserRole();
    if (!gate) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    if (gate.role !== "interno" && gate.role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const supabase = supabaseServer();
    const auditoriaId = params.id;

    // reabrir = voltar pra em_andamento (auditor pode editar de novo)
    const { data: updated, error: upErr } = await supabase
      .from("auditorias")
      .update({ status: "em_andamento" })
      .eq("id", auditoriaId)
      .select("id, status")
      .single();

    if (upErr || !updated) {
      return NextResponse.json({ error: upErr?.message ?? "Falha ao reabrir auditoria" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
