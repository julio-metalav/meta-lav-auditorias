export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const auditoriaId = params.id;
  const admin = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));

    const agua_leitura_base = toNumOrNull(body?.agua_leitura_base);
    const energia_leitura_base = toNumOrNull(body?.energia_leitura_base);
    const gas_leitura_base = toNumOrNull(body?.gas_leitura_base);

    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id,status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });
    }

    // não bloqueia por status: base pode ser necessária em auditorias antigas também
    const { data: updated, error } = await admin
      .from("auditorias")
      .update({
        agua_leitura_base,
        energia_leitura_base,
        gas_leitura_base,
        leitura_base_origem: "manual",
      })
      .eq("id", auditoriaId)
      .select("agua_leitura_base,energia_leitura_base,gas_leitura_base,leitura_base_origem")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, base: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
