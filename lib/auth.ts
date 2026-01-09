import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export type Role = "auditor" | "interno" | "gestor";

type CookieToSet = {
  name: string;
  value: string;
  options?: {
    domain?: string;
    path?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
};

export function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ok
          }
        },
      },
    }
  );
}

/**
 * Admin (service role) – útil para rotas que precisam listar/criar usuários sem depender do cookie.
 * ATENÇÃO: só usar em endpoints protegidos.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, service, { auth: { persistSession: false } });
}

/**
 * Retorna supabase + user + role (para usar nos route handlers /api/*).
 * Lança erro "NOT_AUTHENTICATED" se não tiver sessão.
 */
export async function getUserAndRole(): Promise<{
  supabase: ReturnType<typeof supabaseServer>;
  user: { id: string; email: string | null };
  role: Role;
}> {
  const supabase = supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) throw new Error("NOT_AUTHENTICATED");

  const user = { id: auth.user.id, email: auth.user.email ?? null };

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) throw new Error(profErr.message);

  const role = (prof?.role as Role) ?? "auditor";
  return { supabase, user, role };
}

/**
 * Hierarquia: gestor >= interno >= auditor
 */
export function roleGte(userRole: Role, required: Role) {
  const rank: Record<Role, number> = {
    auditor: 1,
    interno: 2,
    gestor: 3,
  };
  return rank[userRole] >= rank[required];
}
