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
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function pickItens(body: any): any[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.itens)) return body.itens;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

/**
 * GET: usado pela tela para carregar ciclos já lançados
 * - fonte principal: auditoria_fechamento_itens (financeiro)
 * - fallback: auditoria_ciclos (legado)
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getRole(supabase);
    if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const auditoriaId = params.id;

    // 1) tenta carregar do fechamento (tabela correta pro financeiro)
    const { data: itens, error: errItens } = await (supabase.from("auditoria_fechamento_itens") as any)
      .select("id,auditoria_id,condominio_maquina_id,ciclos,valor_total,created_at")
      .eq("auditoria_id", auditoriaId)
      .order("created_at", { ascending: true });

    if (errItens) return NextResponse.json({ error: errItens.message }, { status: 400 });

    if ((itens ?? []).length > 0) {
      return NextResponse.json({ ok: true, source: "auditoria_fechamento_itens", itens });
    }

    // 2) fallback: legado
    const { data: ciclosLegado, error: errLeg } = await (supabase.from("auditoria_ciclos") as any)
      .select("id,auditoria_id,categoria,capacidade_kg,ciclos,created_at")
      .eq("auditoria_id", auditoriaId)
      .order("created_at", { ascending: true });

    if (errLeg) return NextResponse.json({ error: errLeg.message }, { status: 400 });

    return NextResponse.json({ ok: true, source: "auditoria_ciclos", itens: ciclosLegado ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST: salva ciclos (interno/gestor)
 * Grava em auditoria_fechamento_itens (fonte usada pela view financeira).
 *
 * Espera receber algo como:
 * { itens: [{ condominio_maquina_id: "...", ciclos: 10 }, ...] }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getRole(supabase);
    if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const auditoriaId = params.id;

    const body = await req.json().catch(() => null);
    const itens = pickItens(body);

    if (!itens.length) {
      return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });
    }

    // idempotente: substitui tudo daquele fechamento
    const { error: delErr } = await (supabase.from("auditoria_fechamento_itens") as any)
      .delete()
      .eq("auditoria_id", auditoriaId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const rowsToInsert = itens.map((it: any) => {
      const ciclos = Number(it?.ciclos ?? 0);
      const condominio_maquina_id = it?.condominio_maquina_id ?? it?.maquina_id ?? null;

      // opcional (se existir no schema)
      const valor_total =
        it?.valor_total === null || it?.valor_total === undefined ? null : Number(it.valor_total);

      return {
        auditoria_id: auditoriaId,
        condominio_maquina_id,
        ciclos: Number.isFinite(ciclos) ? ciclos : 0,
        valor_total: Number.isFinite(valor_total as any) ? valor_total : null,
      };
    });

    const { error: insErr } = await (supabase.from("auditoria_fechamento_itens") as any).insert(rowsToInsert);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
