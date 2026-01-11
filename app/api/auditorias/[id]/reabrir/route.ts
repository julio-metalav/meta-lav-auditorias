export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role, supabase } = await getUserAndRole();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    if (!roleGte(role as Role, "interno")) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const id = params.id;

    // pega auditoria atual
    const { data: cur, error: curErr } = await supabase
      .from("auditorias")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();

    if (curErr) throw curErr;
    if (!cur) return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });

    const de_status = (cur.status ?? null) as string | null;

    // reabrir = volta pra "aberta" (tem que bater com o check constraint)
    const para_status: Status = "aberta";

    // atualiza auditoria
    const { data: updated, error: upErr } = await supabase
      .from("auditorias")
      .update({ status: para_status })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (upErr) throw upErr;

    // histórico (best-effort: se a tabela não existir, não derruba o endpoint)
    try {
      const admin = supabaseAdmin(); // ✅ aqui está a correção
      await admin.from("auditorias_historico").insert({
        auditoria_id: id,
        de_status,
        para_status,
        actor_id: user.id,
      });
    } catch {
      // ignora
    }

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
