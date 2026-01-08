export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function assertGestorByEmail(email?: string | null) {
  if (!email) return false;

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("email", email)
    .single();

  if (error) return false;
  return data?.role === "gestor";
}

// GET /api/users
export async function GET(req: Request) {
  const email = req.headers.get("x-user-email"); // vem do middleware/layout
  const isGestor = await assertGestorByEmail(email);

  if (!isGestor) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

// POST /api/users
export async function POST(req: Request) {
  const emailHeader = req.headers.get("x-user-email");
  const isGestor = await assertGestorByEmail(emailHeader);

  if (!isGestor) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "").trim();
  const role = String(body?.role ?? "auditor").toLowerCase();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email e password são obrigatórios" },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
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
    role,
  });

  if (profErr) {
    return NextResponse.json(
      { error: profErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
