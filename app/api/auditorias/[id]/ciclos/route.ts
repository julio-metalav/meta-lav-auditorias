export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategoria(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora" || s === "secadora") return s;
  return s || "lavadora";
}

function seedDefaultItems() {
  // padrão que atende teu caso (10kg e 15kg)
  return [
    { categoria: "lavadora", capacidade_kg: 10, ciclos: 0 },
    { categoria: "lavadora", capacidade_kg: 15, ciclos: 0 },
    { categoria: "secadora", capacidade_kg: 10, ciclos: 0 },
    { categoria: "secadora", capacidade_kg: 15, ciclos: 0 },
  ];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = params.id;

    const sb = supabaseAdmin();

    const { data: aud, error: audErr } = await sb
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    const { data: condo, error: condoErr } = await sb
      .from("condominios")
      .select("id, valor_ciclo_lavadora, valor_ciclo_secadora")
      .eq("id", aud.condominio_id)
      .maybeSingle();

    if (condoErr) return bad(condoErr.message, 500);

    const valorLav = Number(condo?.valor_ciclo_lavadora ?? 0);
    const valorSec = Number(condo?.valor_ciclo_secadora ?? 0);

    const { data: rows, error: rowsErr } = await sb
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos, created_at, updated_at")
      .eq("auditoria_id", auditoriaId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (rowsErr) return bad(rowsErr.message, 500);

    const baseList = (rows ?? []).length > 0 ? rows : seedDefaultItems();

    const itens = (baseList as any[]).map((r) => {
      const categoria = normalizeCategoria(r.categoria);
      const capacidade_kg = safeNum(r.capacidade_kg);
      const ciclos = Math.max(0, Number(r.ciclos ?? 0));
      const valor_ciclo = categoria === "secadora" ? valorSec : valorLav;

      return {
        id: r.id ?? null,
        auditoria_id: auditoriaId,
        categoria,
        capacidade_kg,
        ciclos,
        valor_ciclo,
      };
    });

    return NextResponse.json({
      ok: true,
      data: {
        auditoria: aud,
        itens,
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = params.id;

    const body = await req.json().catch(() => null);
    const itens = Array.isArray(body?.itens) ? body.itens : null;
    if (!itens) return bad("Payload inválido. Esperado {itens:[...]}");

    const sb = supabaseAdmin();

    // Confere auditoria + condomínio
    const { data: aud, error: audErr } = await sb
      .from("auditorias")
      .select("id, condominio_id")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    // Normaliza e valida
    const normalized = itens.map((x: any) => {
      const categoria = normalizeCategoria(x.categoria);
      const capacidade_kg = safeNum(x.capacidade_kg);
      const ciclos = safeNum(x.ciclos);

      if (!categoria) throw new Error("categoria obrigatória");
      if (capacidade_kg === null) throw new Error("capacidade_kg obrigatória");
      if (ciclos === null) throw new Error("ciclos obrigatório");

      return {
        auditoria_id: auditoriaId,
        categoria,
        capacidade_kg: Number(capacidade_kg),
        ciclos: Math.max(0, Math.trunc(Number(ciclos))),
      };
    });

    // Upsert por (auditoria_id, categoria, capacidade_kg)
    // OBS: isso pressupõe unique index. Se não existir ainda, a gente cria no próximo passo.
    const { error: upErr } = await sb
      .from("auditoria_ciclos")
      .upsert(normalized, { onConflict: "auditoria_id,categoria,capacidade_kg" });

    if (upErr) return bad(upErr.message, 500);

    const { data: after, error: afterErr } = await sb
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos")
      .eq("auditoria_id", auditoriaId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (afterErr) return bad(afterErr.message, 500);

    return NextResponse.json({ ok: true, data: { itens: after ?? [] } });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
