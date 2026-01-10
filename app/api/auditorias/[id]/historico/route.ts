export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (prof?.role ?? null) as Role | null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // garante que auditoria existe
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });
    }

    // logs: colunas reais
    const { data: logs, error: logErr } = await supabase
      .from("auditoria_status_logs")
      .select("id, auditoria_id, de_status, para_status, user_id, created_at")
      .eq("auditoria_id", auditoriaId)
      .order("created_at", { ascending: false });

    if (logErr) {
      return NextResponse.json({ error: logErr.message }, { status: 400 });
    }

    // busca emails/roles no profiles (sem FK, via IN)
    const userIds = Array.from(
      new Set((logs ?? []).map((l: any) => l.user_id).filter(Boolean))
    ) as string[];

    let byId = new Map<string, { email: string | null; role: Role | null }>();

    if (userIds.length > 0) {
      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id, email, role")
        .in("id", userIds);

      // Se der erro por RLS, só cai no fallback (mostra user_id mesmo)
      if (!profErr && Array.isArray(profs)) {
        byId = new Map(
          profs.map((p: any) => [
            p.id,
            { email: p.email ?? null, role: (p.role ?? null) as Role | null },
          ])
        );
      }
    }

    const data = (logs ?? []).map((l: any) => {
      const actor = byId.get(l.user_id) ?? null;
      return {
        id: l.id,
        auditoria_id: l.auditoria_id,
        de_status: l.de_status,
        para_status: l.para_status,
        created_at: l.created_at,
        actor: {
          id: l.user_id,
          email: actor?.email ?? null,
          role: actor?.role ?? null,
        },
      };
    });

    const role = await getUserRole(supabase);

    return NextResponse.json({ ok: true, role, data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
