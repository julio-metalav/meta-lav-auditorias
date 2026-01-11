export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia") return "em_conferencia";
  if (s === "em_conferência") return "em_conferencia";
  if (s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const r = (role ?? null) as Role | null;
    if (r !== "interno" && r !== "gestor") {
      return NextResponse.json({ error: "Sem permissão (apenas interno/gestor)" }, { status: 403 });
    }

    const id = params.id;
    if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    let body: any = {};
    try {
      body = await _req.json();
    } catch {
      body = {};
    }

    const motivo = String(body?.motivo ?? "").trim();
    if (!motivo) {
      return NextResponse.json({ error: "Motivo da reabertura é obrigatório." }, { status: 400 });
    }
    if (motivo.length > 500) {
      return NextResponse.json({ error: "Motivo muito longo (máx 500 caracteres)." }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // 1) busca auditoria atual (pra registrar no histórico)
    const { data: aud0, error: getErr } = await admin
      .from("auditorias")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!aud0) return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });

    const de_status = normalizeStatus(aud0.status);
    const para_status: Status = "aberta";

    // 2) reabre
    const { data: upd, error: updErr } = await admin
      .from("auditorias")
      .update({ status: para_status })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updErr) throw updErr;

    // 3) histórico (best-effort)
    // tenta inserir com coluna "motivo"; se não existir, re-tenta sem motivo
    try {
      const { error: hErr } = await admin.from("auditorias_historico").insert({
        auditoria_id: id,
        de_status,
        para_status,
        actor_id: user.id,
        motivo,
      });
      if (hErr) throw hErr;
    } catch {
      try {
        await admin.from("auditorias_historico").insert({
          auditoria_id: id,
          de_status,
          para_status,
          actor_id: user.id,
        });
      } catch {
        // ignora
      }
    }

    return NextResponse.json({ ok: true, auditoria: upd });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
