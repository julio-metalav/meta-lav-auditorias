import { supabaseServer } from "@/lib/supabaseServer";

export type Role = "auditor" | "interno" | "gestor";

export async function getUserAndRole() {
  const supabase = supabaseServer();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return { user: null, role: null as Role | null };

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profErr) return { user: auth.user, role: null as Role | null };

  return { user: auth.user, role: (profile?.role as Role) ?? null };
}

export function roleAtLeast(role: Role, min: Role) {
  const order: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  return order[role] >= order[min];
}
