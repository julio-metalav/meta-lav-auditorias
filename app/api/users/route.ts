import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

async function assertGestor() {
  const supabase = createRouteHandlerClient({ cookies });

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return { ok: false as const, status: 401, msg: "Não autenticado" };
  }

  const user = authData.user;

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profErr) {
    return {
      ok: false as const,
      status: 500,
      msg: `Erro lendo profiles: ${profErr.message}`,
    };
  }

  if (profile?.role !== "gestor") {
    return {
      ok: false as const,
      status: 403,
      msg: "Só o gestor pode criar/gerenciar usuários.",
    };
  }

  return { ok: true as const, userId: user.id, email: user.email };
}

// GET /api/users
export async function GET() {
  const gate = await assertGestor();
  if (!gate.ok)
    return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const supabase = createRouteHandlerClient({ cookies });
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users: data ?? [] });
}

// POST /api/users
export async function POST(req: Request) {
  const gate = await assertGestor();
  if (!gate.ok)
    return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const { email, password, role } = body as {
    email?: string;
    password?: string;
    role?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: "email e password são obrigatórios" },
      { status: 400 }
    );
  }

  const newRole = (role ?? "auditor").toLowerCase();
  if (!["gestor", "interno", "auditor"].includes(newRole)) {
    return NextResponse.json({ error: "role inválido" }, { status: 400 });
  }

  const admin = adminClient();

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? "Falha criando usuário" },
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
      {
        error: `Usuário criado no Auth, mas falhou profile: ${profErr.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
