import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

export type Role = "auditor" | "interno" | "gestor";

const ROLE_WEIGHT: Record<Role, number> = {
  auditor: 1,
  interno: 2,
  gestor: 3,
};

export function roleGte(a?: Role | null, b: Role = "auditor") {
  const aa: Role = (a ?? "auditor") as Role;
  return (ROLE_WEIGHT[aa] ?? 0) >= ROLE_WEIGHT[b];
}

export async function getUserAndRole() {
  const supabase = createServerComponentClient({ cookies });

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const user = authData?.user ?? null;

  if (authErr || !user) {
    return { user: null, role: null as Role | null, supabase };
  }

  // pega role do profiles
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // se não conseguir ler, devolve null (pra você enxergar o problema)
  if (profErr) {
    return { user, role: null as Role | null, supabase };
  }

  const role = (profile?.role ?? null) as Role | null;
  return { user, role, supabase };
}
