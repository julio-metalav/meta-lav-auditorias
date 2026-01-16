export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normCategoria(x: any) {
  const s = String(x ?? "").trim().toLowerCase();
  if (s.includes("lav")) return "lavadora";
  if (s.includes("sec")) return "secadora";
  return s || null;
}

function normCapKg(x: any) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normInt(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function makeTag(condominioId: string, categoria: string, capKg: number) {
  // tag estável e sempre preenchida (NOT NULL)
  // exemplo: ML-<8chars>-lavadora-10kg
  const short = String(condominioId).replace(/-/g, "").slice(0, 8);
  return `ML-${short}-${categoria}-${capKg}kg`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const condominioId = params.id;
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("condominio_maquinas")
      .select("id,condominio_id,maquina_tag,categoria,capacidade_kg,quantidade,valor_ciclo,limpeza_mecanica_ciclos,limpeza_quimica_ciclos")
      .eq("condominio_id", condominioId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    // mantém compat: itens/items
    return NextResponse.json({ ok: true, itens: data ?? [], items: data ?? [], data: { itens: data ?? [] } }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    if (!roleGte(role, "interno")) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const condominioId = params.id;
    const sb = supabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const itensRaw: any[] =
      Array.isArray(body?.itens) ? body.itens : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];

    // normaliza + remove inválidos
    const normalized = (itensRaw ?? [])
      .map((it: any) => {
        const categoria = normCategoria(it?.categoria ?? it?.tipo);
        const capacidade_kg = normCapKg(it?.capacidade_kg ?? it?.capacidadeKg ?? it?.capacidade);
        if (!categoria || capacidade_kg === null) return null;

        const quantidade = normInt(it?.quantidade ?? it?.qtd ?? 1, 1);
        const valor_ciclo = it?.valor_ciclo !== undefined && it?.valor_ciclo !== null ? normNum(it.valor_ciclo, 0) : undefined;

        const limpeza_mecanica_ciclos =
          it?.limpeza_mecanica_ciclos !== undefined && it?.limpeza_mecanica_ciclos !== null
            ? normInt(it.limpeza_mecanica_ciclos, 0)
            : undefined;

        const limpeza_quimica_ciclos =
          it?.limpeza_quimica_ciclos !== undefined && it?.limpeza_quimica_ciclos !== null ? normInt(it.limpeza_quimica_ciclos, 0) : undefined;

        // ✅ GARANTE NOT NULL
        const maquina_tag = String(it?.maquina_tag ?? "").trim() || makeTag(condominioId, categoria, capacidade_kg);

        const row: any = {
          condominio_id: condominioId,
          categoria,
          capacidade_kg,
          maquina_tag,
          quantidade,
        };

        // só seta se vier (pra não quebrar schemas antigos)
        if (valor_ciclo !== undefined) row.valor_ciclo = valor_ciclo;
        if (limpeza_mecanica_ciclos !== undefined) row.limpeza_mecanica_ciclos = limpeza_mecanica_ciclos;
        if (limpeza_quimica_ciclos !== undefined) row.limpeza_quimica_ciclos = limpeza_quimica_ciclos;

        return row;
      })
      .filter(Boolean) as any[];

    // ✅ dedupe por (categoria+capacidade_kg) pra não estourar a constraint
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const it of normalized) {
      const key = `${it.categoria}::${it.capacidade_kg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }

    // ✅ UPSERT pela constraint única existente
    const { data, error } = await sb
      .from("condominio_maquinas")
      .upsert(deduped, {
        onConflict: "condominio_id,categoria,capacidade_kg",
        ignoreDuplicates: false,
      })
      .select("id,condominio_id,maquina_tag,categoria,capacidade_kg,quantidade,valor_ciclo,limpeza_mecanica_ciclos,limpeza_quimica_ciclos");

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, data: data ?? [], itens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}
