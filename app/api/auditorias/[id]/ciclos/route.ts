import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(supabase: any): Promise<Role | null> {
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

function roleGte(role: Role | null, min: Exclude<Role, "auditor">): boolean {
  const w: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return (w[role] ?? 0) >= (w[min] ?? 0);
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const auditoriaId = params.id;

    // 1) auditoria precisa existir
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id, condominio_id, ano_mes, mes_ref, status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json(
        { error: audErr?.message ?? "Auditoria não encontrada" },
        { status: 404 }
      );
    }

    // 2) máquinas do condomínio (se você tiver coluna "ativo", pode reativar o filtro)
    const { data: maquinas, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select(
        "id, condominio_id, categoria, capacidade_kg, quantidade, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos"
      )
      .eq("condominio_id", aud.condominio_id)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (maqErr) {
      return NextResponse.json({ error: maqErr.message }, { status: 400 });
    }

    // 3) ciclos já lançados (normaliza para `ciclos`)
    const { data: ciclosRaw, error: cicErr } = await supabase
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos_mes")
      .eq("auditoria_id", auditoriaId);

    if (cicErr) {
      return NextResponse.json({ error: cicErr.message }, { status: 400 });
    }

    const ciclos = (ciclosRaw ?? []).map((c: any) => ({
      id: c.id,
      auditoria_id: c.auditoria_id,
      categoria: c.categoria,
      capacidade_kg: c.capacidade_kg ?? null,
      ciclos: Number(c.ciclos_mes ?? 0),
      ciclos_mes: Number(c.ciclos_mes ?? 0),
    }));

    return NextResponse.json({
      auditoria: aud,
      condominio_id: aud.condominio_id,
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const role = await getUserRole(supabase);

    // Permissão: interno/gestor
    if (!roleGte(role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const auditoriaId = params.id;

    // garante auditoria existe (evita FK confuso)
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

    // aceita lista ou 1 item
    const items = Array.isArray(body) ? body : body ? [body] : [];

    // ✅ array vazio = OK (no-op)
    if (items.length === 0) {
      return NextResponse.json({ ok: true, upserted: 0 });
    }

    const payload = items.map((it: any) => {
      const categoria = normCategoria(it.categoria);
      const capacidade_kg = toNumOrNull(it.capacidade_kg);

      // aceita `ciclos` (frontend) ou `ciclos_mes` (legado)
      const ciclos_in = it.ciclos ?? it.ciclos_mes ?? it.ciclosMes;
      const ciclos_mes = toNonNegInt(ciclos_in);

      return {
        auditoria_id: auditoriaId,
        categoria,
        capacidade_kg,
        ciclos_mes,
      };
    });

    for (const p of payload) {
      if (!p.categoria) {
        return NextResponse.json({ error: "categoria é obrigatória" }, { status: 400 });
      }
      if (p.capacidade_kg !== null && !Number.isFinite(Number(p.capacidade_kg))) {
        return NextResponse.json({ error: "capacidade_kg inválido" }, { status: 400 });
      }
      if (!Number.isFinite(Number(p.ciclos_mes)) || Number(p.ciclos_mes) < 0) {
        return NextResponse.json({ error: "ciclos inválido" }, { status: 400 });
      }
    }

    // ✅ Upsert por chave composta (auditoria_id, categoria, capacidade_kg)
    const { data: saved, error: upErr } = await supabase
      .from("auditoria_ciclos")
      .upsert(payload, { onConflict: "auditoria_id,categoria,capacidade_kg" })
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos_mes");

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      upserted: saved?.length ?? 0,
      data: (saved ?? []).map((r: any) => ({
        ...r,
        ciclos: Number(r.ciclos_mes ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
