export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normRole(v: any): Role | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "auditor" || s === "interno" || s === "gestor") return s as Role;
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role, "gestor")) return bad("Sem permissão", 403);

  const id = params.id;
  if (!id) return bad("ID inválido");

  const body = await req.json().catch(() => ({}));
  const newRole = normRole(body?.role);

  if (!newRole) return bad("Role inválida");

  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("profiles")
    .update({ role: newRole })
    .eq("id", id)
    .select("id,email,role,created_at")
    .single();

  if (error) return bad(error.message);

  return NextResponse.json({ ok: true, user: data });
}
