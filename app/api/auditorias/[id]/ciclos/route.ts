export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return s || "aberta";
}

function makeTag(categoria: any, capacidade: any, idx: number) {
  const c = String(categoria ?? "MAQ").toUpperCase().replace(/\s+/g, "_");
  const k = capacidade ? String(capacidade) : "0";
  return `${c}_${k}_${String(idx).padStart(2, "0")}`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = ctx.role as Role | null;
  if (!roleGte(role, "auditor")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const auditoriaId = params.id;

  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("*")
    .eq("id", auditoriaId)
    .maybeSingle();

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
  if (!aud) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

  const { data: maquinas, error: mErr } = await admin
    .from("condominio_maquinas")
    .select("categoria,capacidade_kg,quantidade,valor_ciclo")
    .eq("condominio_id", aud.condominio_id)
    .order("categoria");

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  const { data: saved, error: sErr } = await admin
    .from("auditoria_ciclos")
    .select("id,auditoria_id,categoria,capacidade_kg,ciclos")
    .eq("auditoria_id", auditoriaId);

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const map = new Map(
    (saved ?? []).map((r: any) => [`${r.categoria}::${r.capacidade_kg}`, r])
  );

  const itens: any[] = [];

  for (const m of maquinas ?? []) {
    const qtd = Number(m.quantidade ?? 0);
    for (let i = 1; i <= qtd; i++) {
      const key = `${m.categoria}::${m.capacidade_kg}`;
      const savedRow = map.get(key);

      itens.push({
        id: savedRow?.id ?? null,
        auditoria_id: auditoriaId,
        maquina_tag: makeTag(m.categoria, m.capacidade_kg, i),
        categoria: m.categoria,
        capacidade_kg: m.capacidade_kg,
        ciclos: Number(savedRow?.ciclos ?? 0),
        valor_ciclo: m.valor_ciclo ?? 0,
      });
    }
  }

  return NextResponse.json({
    data: {
      auditoria: {
        id: aud.id,
        condominio_id: aud.condominio_id,
        mes_ref: aud.mes_ref,
        status: normalizeStatus(aud.status),
      },
      itens,
    },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = ctx.role as Role | null;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const auditoriaId = params.id;

  const body = await req.json();
  const itens = Array.isArray(body?.itens) ? body.itens : [];

  const payload = itens.map((it: any) => ({
    auditoria_id: auditoriaId,
    categoria: it.categoria,
    capacidade_kg: it.capacidade_kg,
    ciclos: Number(it.ciclos ?? 0),
  }));

  const { error } = await admin.from("auditoria_ciclos").upsert(payload, {
    onConflict: "auditoria_id,categoria,capacidade_kg",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
