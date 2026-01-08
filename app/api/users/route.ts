export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte, type Role } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normRole(r: string): Role {
  const rr = (r || "auditor").toLowerCase().trim();
  if (rr === "gestor" || rr === "interno" || rr === "auditor") return rr as Role;
  return "auditor";
}

// GET /api/users  -> lista profiles (somente gestor)
export async function GET() {
  const { user, role } = await getUserAndRole();
  return NextResponse.json({
  debug: true,
  email: user?.email ?? null,
  userId: user?.id ?? null,
  role: role ?? null,
});


  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!roleGte(role, "gestor")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();

  // lista via admin para não depender de RLS
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

// POST /api/users -> cria usuário no Auth + cria/atualiza profile (somente gestor)
export async function POST(req: Request) {
  const { user, role } = await getUserAndRole();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!roleGte(role, "gestor")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "").trim();
  const newRole = normRole(String(body?.role ?? "auditor"));

  if (!email || !password) {
    return NextResponse.json(
      { error: "email e password são obrigatórios" },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? "Falha ao criar usuário" },
      { status: 500 }
    );
  }

  const { error: profErr } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    role: newRole,
  });

  if (profErr) {
    return NextResponse.json(
      { error: `Usuário criado no Auth, mas falhou profile: ${profErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
