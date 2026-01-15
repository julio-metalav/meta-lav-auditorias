export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (prof?.role ?? null) as Role | null;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = supabaseServer();

  const role = await getRole(supabase);
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("auditoria_ciclos")
    .select("*")
    .eq("auditoria_id", params.id)
    .order("categoria", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    source: "auditoria_ciclos",
    itens: data ?? [],
  });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = supabaseServer();

  const role = await getRole(supabase);
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const itens = Array.isArray(body?.itens)
    ? body.itens
    : Array.isArray(body)
    ? body
    : [];

  if (!itens.length) {
    return NextResponse.json({ error: "Nenhum ciclo informado" }, { status: 400 });
  }

  // idempotente: apaga e recria
  const { error: delErr } = await supabase
    .from("auditoria_ciclos")
    .delete()
    .eq("auditoria_id", params.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  const rows = itens.map((it: any) => ({
    auditoria_id: params.id,
    categoria: String(it.categoria ?? "").toLowerCase(),
    capacidade_kg: Number(it.capacidade_kg),
    ciclos: Number(it.ciclos ?? 0),
  }));

  const { error: insErr } = await supabase
    .from("auditoria_ciclos")
    .insert(rows);

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
