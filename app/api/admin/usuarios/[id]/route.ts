export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  return !!role && rank[role] >= rank[min];
}

function isMissingRelation(msg: string) {
  const s = (msg || "").toLowerCase();
  return s.includes("does not exist") || s.includes("relation") || s.includes("schema cache");
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (!roleGte(role as Role, "gestor")) {
      return NextResponse.json({ error: "Sem permissão (apenas Gestor)." }, { status: 403 });
    }

    const userId = String(ctx.params.id || "").trim();
    if (!userId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    if (userId === user.id) {
      return NextResponse.json({ error: "Você não pode excluir seu próprio usuário." }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // Guardrail: não excluir se existir histórico em auditorias
    const [a1, a2, a3] = await Promise.all([
      admin.from("auditorias").select("id", { count: "exact", head: true }).eq("auditor_id", userId),
      admin.from("auditorias").select("id", { count: "exact", head: true }).eq("created_by", userId),
      admin.from("auditorias").select("id", { count: "exact", head: true }).eq("fechado_por", userId),
    ]);

    const auditor = (a1 as any).count ?? 0;
    const created = (a2 as any).count ?? 0;
    const fechado = (a3 as any).count ?? 0;

    if (auditor + created + fechado > 0) {
      return NextResponse.json(
        {
          error:
            "Não posso excluir: usuário já aparece em auditorias (histórico). Sugestão: troque a role em vez de apagar.",
          details: { auditor_id: auditor, created_by: created, fechado_por: fechado },
        },
        { status: 409 }
      );
    }

    // Remover vínculos (se existir)
    {
      const { error } = await admin.from("auditor_condominios").delete().eq("auditor_id", userId);
      if (error && !isMissingRelation(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Remover profile (se existir)
    {
      const { error } = await admin.from("profiles").delete().eq("id", userId);
      if (error && !isMissingRelation(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Excluir no Auth (Supabase)
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
