import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type Role = "auditor" | "interno" | "gestor";

function roleRank(role: Role | null) {
  const w: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return 0;
  return w[role] ?? 0;
}

function roleGte(role: Role | null, min: Role): boolean {
  return roleRank(role) >= roleRank(min);
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (profErr) return null;
  return (prof?.role ?? null) as Role | null;
}

function normCategoria(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora" || s === "secadora") return s;
  return "";
}

function toNumOrNull(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNonNegInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i;
}

/**
 * GET /api/auditorias/:id/ciclos
 * Retorna:
 * - auditoria (com alias ano_mes => mes_ref para compat)
 * - condominio_id
 * - maquinas
 * - ciclos (com alias ciclos_mes para compat)
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    // auth obrigatório
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // qualquer role logada pode ler (auditor/interno/gestor)
    const role = await getUserRole(supabase);
    if (!roleGte(role, "auditor")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // ✅ BANCO REAL: NÃO existe ano_mes. Usamos apenas mes_ref.
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json(
        { error: audErr?.message ?? "Auditoria não encontrada" },
        { status: 404 }
      );
    }

    const condominioId = (aud as any).condominio_id as string;

    const { data: maquinas, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select(
        "id, condominio_id, categoria, capacidade_kg, quantidade, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos"
      )
      .eq("condominio_id", condominioId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (maqErr) {
      return NextResponse.json({ error: maqErr.message }, { status: 400 });
    }

    // ✅ BANCO REAL: coluna é "ciclos"
    const { data: ciclosRaw, error: cicErr } = await supabase
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos")
      .eq("auditoria_id", auditoriaId);

    if (cicErr) {
      return NextResponse.json({ error: cicErr.message }, { status: 400 });
    }

    // compat: devolve também ciclos_mes (alias)
    const ciclos = (ciclosRaw ?? []).map((c: any) => ({
      id: c.id,
      auditoria_id: c.auditoria_id,
      categoria: c.categoria,
      capacidade_kg: c.capacidade_kg ?? null,
      ciclos: Number(c.ciclos ?? 0),
      ciclos_mes: Number(c.ciclos ?? 0),
    }));

    // compat: devolve ano_mes como alias do mes_ref (sem depender de coluna inexistente)
    const auditoria = {
      ...(aud as any),
      ano_mes: (aud as any).mes_ref ?? null,
    };

    return NextResponse.json({
      auditoria,
      condominio_id: condominioId,
      maquinas: maquinas ?? [],
      ciclos,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auditorias/:id/ciclos
 * Somente interno/gestor.
 * Aceita array ou objeto:
 * - categoria: lavadora|secadora
 * - capacidade_kg
 * - ciclos (ou ciclos_mes)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const role = await getUserRole(supabase);
    if (!roleGte(role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json(
        { error: audErr?.message ?? "Auditoria não encontrada" },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => null);
    const items = Array.isArray(body) ? body : body ? [body] : [];

    if (items.length === 0) {
      return NextResponse.json({ ok: true, upserted: 0, data: [] });
    }

    // ✅ BANCO REAL: salva em "ciclos"
    const payload = items.map((it: any) => {
      const categoria = normCategoria(it.categoria);
      const capacidade_kg = toNumOrNull(it.capacidade_kg);
      const ciclos_in = it.ciclos ?? it.ciclos_mes ?? it.ciclosMes;
      const ciclos = toNonNegInt(ciclos_in);
      return { auditoria_id: auditoriaId, categoria, capacidade_kg, ciclos };
    });

    for (const p of payload) {
      if (!p.categoria) {
        return NextResponse.json(
          { error: "categoria é obrigatória (lavadora|secadora)" },
          { status: 400 }
        );
      }
      if (p.capacidade_kg !== null && !Number.isFinite(Number(p.capacidade_kg))) {
        return NextResponse.json({ error: "capacidade_kg inválido" }, { status: 400 });
      }
      if (!Number.isFinite(Number(p.ciclos)) || Number(p.ciclos) < 0) {
        return NextResponse.json({ error: "ciclos inválido" }, { status: 400 });
      }
    }

    const { data: saved, error: upErr } = await supabase
      .from("auditoria_ciclos")
      .upsert(payload, { onConflict: "auditoria_id,categoria,capacidade_kg" })
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos");

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      upserted: saved?.length ?? 0,
      data: (saved ?? []).map((r: any) => ({
        ...r,
        ciclos: Number(r.ciclos ?? 0),
        ciclos_mes: Number(r.ciclos ?? 0), // compat
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
