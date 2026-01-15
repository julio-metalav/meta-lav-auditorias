export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeStatus(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "final") return "final";
  if (s === "em_conferencia" || s === "em conferencia") return "em_conferencia";
  if (s === "em_andamento" || s === "em andamento") return "em_andamento";
  return "aberta";
}

// POST /api/auditorias/:id/finalizar
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);

    const r = (role ?? null) as Role | null;
    if (!roleGte(r, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = String(params?.id ?? "").trim();
    if (!auditoriaId) return bad("ID da auditoria ausente.", 400);

    const admin = supabaseAdmin();

    // pega status atual (pra evitar finalizar algo inexistente)
    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id, status")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada.", 404);

    const cur = normalizeStatus((aud as any)?.status);
    if (cur === "final") {
      return NextResponse.json({ ok: true, data: { id: auditoriaId, status: "final" } });
    }

    const { data: upd, error: updErr } = await admin
      .from("auditorias")
      .update({ status: "final" })
      .eq("id", auditoriaId)
      .select("id, status")
      .maybeSingle();

    if (updErr) return bad(updErr.message, 500);

    return NextResponse.json({ ok: true, data: upd ?? { id: auditoriaId, status: "final" } });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
