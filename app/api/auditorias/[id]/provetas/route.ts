export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function safeId(v: any) {
  return String(v ?? "").trim();
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const auditoriaId = safeId(ctx?.params?.id);
  if (!auditoriaId) return bad("ID da auditoria ausente", 400);

  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);

  const admin = supabaseAdmin();

  // 1) Segurança: valida acesso do auditor à própria auditoria
  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("id,auditor_id")
    .eq("id", auditoriaId)
    .maybeSingle();

  if (audErr) return bad("Erro ao buscar auditoria", 500, { details: audErr.message });
  if (!aud) return bad("Auditoria não encontrada", 404);

  if (role === "auditor") {
    if (!aud.auditor_id || aud.auditor_id !== user.id) {
      return bad("Sem permissão para acessar esta auditoria", 403);
    }
  } else {
    // interno/gestor: mantém regra por hierarquia (RLS = Row Level Security, se existir no projeto)
    if (!role) return bad("Sem permissão", 403);
    if (!roleGte(role as Role, "interno")) {
      return bad("Sem permissão", 403);
    }
  }

  // 2) Lista provetas
  const { data, error } = await admin
    .from("auditoria_provetas")
    .select("maquina_tag,maquina_idx,foto_url")
    .eq("auditoria_id", auditoriaId)
    .order("maquina_tag", { ascending: true })
    .order("maquina_idx", { ascending: true });

  if (error) return bad("Erro ao buscar provetas", 500, { details: error.message });

  return NextResponse.json(data ?? []);
}
