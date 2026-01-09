import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

type Role = "auditor" | "interno" | "gestor";

function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Em Route Handler pode dar read-only; ok ignorar.
          }
        },
      },
    }
  );
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, service, { auth: { persistSession: false } });
}

async function requireManager() {
  const supabase = supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return { ok: false as const, status: 401, msg: "Não autenticado" };
  }

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profErr) return { ok: false as const, status: 500, msg: profErr.message };

  const role = (prof?.role as Role) ?? null;
  if (role !== "gestor" && role !== "interno") {
    return { ok: false as const, status: 403, msg: "Sem permissão" };
  }

  return { ok: true as const, user: auth.user, role };
}

// GET /api/users -> lista usuários do Auth + role do profiles
export async function GET() {
  const gate = await requireManager();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const admin = adminClient();

  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });

  const ids = (usersData?.users ?? []).map((u) => u.id);

  const { data: profs, error: profErr } = await admin
    .from("profiles")
    .select("id, role")
    .in("id", ids);

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  const roleById = new Map((profs ?? []).map((p) => [p.id, p.role]));

  const out = (usersData?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    role: (roleById.get(u.id) as Role) ?? null,
  }));

  return NextResponse.json(out);
}

// POST /api/users -> cria usuário + grava role em profiles
export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as {
    email?: string;
    senha?: string;
    role?: Role;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const senha = String(body.senha ?? "");
  const role = (body.role ?? "auditor") as Role;

  if (!email || !senha) {
    return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 });
  }

  const admin = adminClient();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? "Falha ao criar usuário" },
      { status: 500 }
    );
  }

  const { error: profErr } = await admin.from("profiles").upsert(
    { id: created.user.id, role },
    { onConflict: "id" }
  );

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: created.user.id, email, role });
}
