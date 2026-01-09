import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
 * Retorna supabase + user + role (para usar nos route handlers /api/*)
 */
export async function getUserAndRole(): Promise<{
  supabase: ReturnType<typeof supabaseServer>;
  user: { id: string; email: string | null };
  role: Role;
}> {
  const supabase = supabaseServer();

  const { data: auth, erro
