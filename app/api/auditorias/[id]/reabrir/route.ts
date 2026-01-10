export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

async function getUserRole(
  supabase: ReturnType<typeof supabaseServer>
): Promise<{ userId: string; role: Role | null } | null> {
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

async function tryLogStatusChange(args: {
  supabase: ReturnType<typeof supabaseServer>;
  auditoriaId: string;
  userId: string;
  de: Status | null;
  para: Status;
}) {
  const { supabase, auditoriaId, userId, de, para } = args;
  if ((de ?? null) === para) return;

  try {
    await supabase.from("auditoria_status_logs").insert({
      auditoria_id: auditoriaId,
      de_status: de,
      para_status: para,
      user_id: userId,
    });
  } catch {
    // não quebra o fluxo
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    const gate = await getUserRole(supabase);
    if (!gate) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    if (gate.role !== "interno" && gate.role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    // pega status atual (pra log)
    const { data: before, error: befErr } = await supabase
      .from("auditorias")
      .select("id, status")
      .eq("id", auditoriaId)
      .single();

    if (befErr || !before) {
      return NextResponse.json({ error: befErr?.message ?? "Auditoria não encontrada" }, { status: 404 });
    }

    const deStatus = (before.status ?? null) as Status | null;

    // ✅ reabrir: volta para em_andamento (auditor pode editar novamente)
    const paraStatus: Status = "em_andamento";

    const { data: updated, error: upErr } = await supabase
      .from("auditorias")
      .update({ status: paraStatus })
      .eq("id", auditoriaId)
      .select("id, status")
      .single();

    if (upErr || !updated) {
      return NextResponse.json(
        { error: upErr?.message ?? "Falha ao reabrir auditoria" },
        { status: 400 }
      );
    }

    // ✅ loga mudança
    await tryLogStatusChange({
      supabase,
      auditoriaId,
      userId: gate.userId,
      de: deStatus,
      para: paraStatus,
    });

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
