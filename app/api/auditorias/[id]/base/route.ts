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
  // aceita "123,45" e "123.45"
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function handleUpsertBase(req: Request, auditoriaId: string) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));

    // ✅ Aceita os 2 formatos (compat)
    const base_agua = toNumOrNull(body?.base_agua ?? body?.agua_leitura_base);
    const base_energia = toNumOrNull(body?.base_energia ?? body?.energia_leitura_base);
    const base_gas = toNumOrNull(body?.base_gas ?? body?.gas_leitura_base);

    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id,status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });
    }

    // ✅ Atualiza os campos que a UI usa hoje: base_agua/base_energia/base_gas
    const { data: updated, error } = await admin
      .from("auditorias")
      .update({
        base_agua,
        base_energia,
        base_gas,
      })
      .eq("id", auditoriaId)
      .select("base_agua,base_energia,base_gas")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, base: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

// ✅ Frontend atual usa POST
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleUpsertBase(req, params.id);
}

// ✅ Mantém compatibilidade com chamadas antigas
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handleUpsertBase(req, params.id);
}
