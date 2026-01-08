export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function GET() {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { data, error } = await supabase
    .from("auditor_condominios")
    .select("auditor_id, condominio_id, condominios(nome,cidade,uf), profiles(email,role)")
    .order("profiles(email)");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const auditor_id = String(body?.auditor_id || "").trim();
  const condominio_id = String(body?.condominio_id || "").trim();
  if (!auditor_id || !condominio_id) {
    return NextResponse.json({ error: "auditor_id e condominio_id são obrigatórios" }, { status: 400 });
  }

  const { error } = await supabase
    .from("auditor_condominios")
    .upsert({ auditor_id, condominio_id }, { onConflict: "auditor_id,condominio_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const auditor_id = String(body?.auditor_id || "").trim();
  const condominio_id = String(body?.condominio_id || "").trim();
  if (!auditor_id || !condominio_id) {
    return NextResponse.json({ error: "auditor_id e condominio_id são obrigatórios" }, { status: 400 });
  }

  const { error } = await supabase
    .from("auditor_condominios")
    .delete()
    .eq("auditor_id", auditor_id)
    .eq("condominio_id", condominio_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
