export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

type AssignmentOut = {
  auditor_id: string;
  condominio_id: string;
  auditor_email: string | null;
  condominio: { id?: string; nome: string; cidade: string; uf: string } | null;
  created_at?: string | null;
};

function jsonError(message: string, statusCode: number) {
  return NextResponse.json({ error: message }, { status: statusCode });
}

async function requireInterno() {
  try {
    const { supabase, user, role } = await getUserAndRole();
    if (!user) return { ok: false as const, res: jsonError("Não autenticado", 401) };
    if (!roleGte(role, "interno")) return { ok: false as const, res: jsonError("Sem permissão", 403) };
    return { ok: true as const, supabase, user, role };
  } catch (e: any) {
    const msg = String(e?.message ?? "NOT_AUTHENTICATED");
    if (msg === "NOT_AUTHENTICATED") return { ok: false as const, res: jsonError("Não autenticado", 401) };
    return { ok: false as const, res: jsonError(msg || "Erro inesperado", 500) };
  }
}

export async function GET() {
  const gate = await requireInterno();
  if (!gate.ok) return gate.res;

  const { supabase } = gate;

  // Tabela real: public.auditor_condominios (auditor_id, condominio_id, created_at)
  const { data, error } = await supabase
    .from("auditor_condominios")
    .select(
      "auditor_id, condominio_id, created_at, condominios(nome,cidade,uf), profiles(email,role)"
    );

  if (error) return jsonError(error.message, 400);

  const out: AssignmentOut[] = (data ?? []).map((row: any) => ({
    auditor_id: row.auditor_id,
    condominio_id: row.condominio_id,
    created_at: row.created_at ?? null,
    auditor_email: row?.profiles?.email ?? null,
    condominio: row?.condominios
      ? {
          nome: row.condominios.nome,
          cidade: row.condominios.cidade,
          uf: row.condominios.uf,
        }
      : null,
  }));

  // Ordena no backend para deixar a UI simples e estável
  out.sort((a, b) => (a.auditor_email ?? "").localeCompare(b.auditor_email ?? ""));

  return NextResponse.json({ data: out });
}

export async function POST(req: Request) {
  const gate = await requireInterno();
  if (!gate.ok) return gate.res;

  const { supabase } = gate;

  const body = await req.json().catch(() => ({}));
  const auditor_id = String(body?.auditor_id ?? "").trim();
  const condominio_id = String(body?.condominio_id ?? "").trim();

  if (!auditor_id || !condominio_id) {
    return jsonError("auditor_id e condominio_id são obrigatórios", 400);
  }

  // Fix definitivo: não depende de constraint única para upsert.
  // Garante que não fica duplicado mesmo se o banco não tiver UNIQUE(auditor_id, condominio_id).
  const del = await supabase
    .from("auditor_condominios")
    .delete()
    .eq("auditor_id", auditor_id)
    .eq("condominio_id", condominio_id);

  if (del.error) return jsonError(del.error.message, 400);

  const ins = await supabase
    .from("auditor_condominios")
    .insert({ auditor_id, condominio_id });

  if (ins.error) return jsonError(ins.error.message, 400);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const gate = await requireInterno();
  if (!gate.ok) return gate.res;

  const { supabase } = gate;

  const body = await req.json().catch(() => ({}));
  const auditor_id = String(body?.auditor_id ?? "").trim();
  const condominio_id = String(body?.condominio_id ?? "").trim();

  if (!auditor_id || !condominio_id) {
    return jsonError("auditor_id e condominio_id são obrigatórios", 400);
  }

  const { error } = await supabase
    .from("auditor_condominios")
    .delete()
    .eq("auditor_id", auditor_id)
    .eq("condominio_id", condominio_id);

  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ ok: true });
}
