export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function safeText(v: any) {
  return String(v ?? "").trim();
}
function toLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const auditoriaId = safeText(ctx?.params?.id);
  if (!auditoriaId) return bad("ID da auditoria ausente", 400);

  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);

  const r: Role | null = (role as any) ?? null;
  if (r !== "interno" && r !== "gestor") return bad("Sem permissão", 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const motivo = safeText(body?.motivo);
  if (!motivo) return bad("Informe o motivo da devolução", 400);

  const admin = supabaseAdmin();

  // 1) Buscar status atual + observacoes (se existir)
  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("id,status,observacoes")
    .eq("id", auditoriaId)
    .maybeSingle();

  if (audErr) return bad("Erro ao buscar auditoria", 500, { details: audErr.message });
  if (!aud) return bad("Auditoria não encontrada", 404);

  const st = toLower(aud.status);
  if (st !== "em_conferencia") {
    return bad("Só é possível devolver quando o status está em conferência", 400, { status_atual: aud.status });
  }

  // 2) Anexar motivo nas observações (sem apagar nada)
  const now = new Date();
  const ts = now.toLocaleString("pt-BR");
  const prefix = `[DEVOLVIDO PELO INTERNO em ${ts}] `;
  const prevObs = safeText((aud as any).observacoes);
  const novaObs = prevObs ? `${prevObs}\n\n${prefix}${motivo}` : `${prefix}${motivo}`;

  // 3) Atualizar status e observacoes
  const { error: upErr } = await admin
    .from("auditorias")
    .update({
      status: "em_andamento",
      observacoes: novaObs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auditoriaId);

  if (upErr) return bad("Erro ao devolver auditoria", 500, { details: upErr.message });

  return NextResponse.json({ ok: true });
}
