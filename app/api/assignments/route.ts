export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function norm(v: any) {
  return String(v ?? "").trim();
}

async function getMeRole(): Promise<{ userId: string; role: Role | null } | null> {
  const sb = supabaseServer();
  const { data: auth, error } = await sb.auth.getUser();
  if (error || !auth?.user) return null;

  const { data: prof } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return { userId: auth.user.id, role: (prof?.role ?? null) as Role | null };
}

function forbid() {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}

export async function GET() {
  const me = await getMeRole();
  if (!me?.role) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (me.role !== "interno" && me.role !== "gestor") return forbid();

  const sb = supabaseAdmin();

  const r = await sb.from("auditor_condominios").select("auditor_id,condominio_id,created_at");
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });

  const rows = (r.data ?? []) as Array<{ auditor_id: string; condominio_id: string; created_at: string }>;

  const auditorIds = Array.from(new Set(rows.map((x) => x.auditor_id).filter(Boolean)));
  const condoIds = Array.from(new Set(rows.map((x) => x.condominio_id).filter(Boolean)));

  const [p, c] = await Promise.all([
    auditorIds.length
      ? sb.from("profiles").select("id,email,role").in("id", auditorIds)
      : Promise.resolve({ data: [], error: null } as any),
    condoIds.length
      ? sb.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (p.error) return NextResponse.json({ error: p.error.message }, { status: 500 });
  if (c.error) return NextResponse.json({ error: c.error.message }, { status: 500 });

  const profById = new Map((p.data ?? []).map((x: any) => [x.id, x]));
  const condoById = new Map((c.data ?? []).map((x: any) => [x.id, x]));

  const out = rows.map((x) => {
    const prof = profById.get(x.auditor_id);
    const condo = condoById.get(x.condominio_id);
    return {
      auditor_id: x.auditor_id,
      condominio_id: x.condominio_id,
      created_at: x.created_at,
      auditor_email: prof?.email ?? null,
      auditor_role: prof?.role ?? null,
      condominio: condo ? { nome: condo.nome, cidade: condo.cidade, uf: condo.uf } : null,
    };
  });

  return NextResponse.json({ data: out });
}

export async function POST(req: Request) {
  const me = await getMeRole();
  if (!me?.role) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (me.role !== "interno" && me.role !== "gestor") return forbid();

  const body = await req.json().catch(() => ({}));
  const auditor_id = norm(body?.auditor_id);
  const condominio_id = norm(body?.condominio_id);

  if (!auditor_id || !condominio_id) {
    return NextResponse.json({ error: "auditor_id e condominio_id são obrigatórios." }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // ✅ REGRA: 1 condomínio = 1 auditor (SUBSTITUI AUTOMATICAMENTE)
  // Com seu índice único em (condominio_id), o certo é UPSERT por condominio_id.
  const r = await sb
    .from("auditor_condominios")
    .upsert({ condominio_id, auditor_id }, { onConflict: "condominio_id" })
    .select("auditor_id,condominio_id,created_at")
    .single();

  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: r.data });
}
