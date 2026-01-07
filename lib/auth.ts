import { supabaseServer } from "@/lib/supabaseServer";

export type Role = "auditor" | "interno" | "gestor";

export async function getUserAndRole() {
  const supabase = supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return { supabase, user: null, role: null as Role | null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  const role = (profile?.role as Role) || null;
  return { supabase, user: auth.user, role };
}

export function roleGte(role: Role | null, min: Role) {
  if (!role) return false;
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  return rank[role] >= rank[min];
}
