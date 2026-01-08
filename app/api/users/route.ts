export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte, type Role } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { user, role, supabase } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "gestor")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "gestor")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "").trim();
  const newRole = String(body?.role || "auditor").trim() as Role;

  if (!email || !password) {
    return NextResponse.json({ error: "email e password são obrigatórios" }, { status: 400 });
  }
  if (!"auditor,interno,gestor".split(",").includes(newRole)) {
    return NextResponse.json({ error: "role inválida" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    return NextResponse.json({ error: createErr?.message || "Falha ao criar usuário" }, { status: 400 });
  }

  const { error: profErr } = await admin
    .from("profiles")
    .insert({ id: created.user.id, email, role: newRole });

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
