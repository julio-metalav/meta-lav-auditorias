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

function normQtd(x: any) {
  const n = Number(x);
  // se não existir quantidade na tabela, deixar como undefined (não envia)
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * IMPORTANTE:
 * A constraint no banco é UNIQUE(condominio_id, categoria, capacidade_kg).
 * Então SEMPRE fazemos UPSERT com onConflict nesses 3 campos.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // só interno/gestor mexe no parque de máquinas
    if (!roleGte(role, "interno")) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const condominioId = params.id;

    const body = await req.json().catch(() => ({}));
    const itensRaw: any[] =
      Array.isArray(body?.itens) ? body.itens : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];

    // normaliza + remove inválidos
    const normalized = (itensRaw ?? [])
      .map((it: any) => {
        const categoria = normCategoria(it?.categoria ?? it?.tipo);
        const capacidade_kg = normCapKg(it?.capacidade_kg ?? it?.capacidadeKg ?? it?.capacidade);

        // quantidade é opcional (só manda se existir)
        const quantidade = normQtd(it?.quantidade ?? it?.qtd);

        return { categoria, capacidade_kg, quantidade };
      })
      .filter((x) => x.categoria && x.capacidade_kg);

    // ✅ DEDUPE por (categoria+capacidade_kg) pra evitar payload duplicado
    const seen = new Set<string>();
    const deduped = [];
    for (const it of normalized) {
      const key = `${it.categoria}::${it.capacidade_kg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }

    // monta rows para upsert
    const rows = deduped.map((it: any) => {
      const row: any = {
        condominio_id: condominioId,
        categoria: it.categoria,
        capacidade_kg: it.capacidade_kg,
      };

      // só envia quantidade se veio (pra não quebrar caso coluna não exista)
      if (it.quantidade !== undefined) row.quantidade = it.quantidade;

      return row;
    });

    const sb = supabaseAdmin();

    // ✅ UPSERT (resolve "duplicate key" automaticamente)
    const { data, error } = await sb
      .from("condominio_maquinas")
      .upsert(rows, {
        onConflict: "condominio_id,categoria,capacidade_kg",
        ignoreDuplicates: false,
      })
      .select("condominio_id,categoria,capacidade_kg,quantidade");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const condominioId = params.id;
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("condominio_maquinas")
      .select("condominio_id,categoria,capacidade_kg,quantidade")
      .eq("condominio_id", condominioId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, itens: data ?? [], data: { itens: data ?? [] } }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}
