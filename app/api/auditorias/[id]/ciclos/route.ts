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

type Precos = {
  // novo (por capacidade)
  lav10?: number | null;
  lav15?: number | null;
  sec10?: number | null;
  sec15?: number | null;

  // fallback antigo
  lav?: number | null;
  sec?: number | null;
};

function pickValorCiclo(precos: Precos, categoria: string, capacidadeKg: number | null) {
  const cap = Number(capacidadeKg ?? 0);

  // prioridade: novo modelo por capacidade
  if (categoria === "lavadora") {
    if (cap === 10 && precos.lav10 != null) return Number(precos.lav10);
    if (cap === 15 && precos.lav15 != null) return Number(precos.lav15);
    // fallback antigo
    if (precos.lav != null) return Number(precos.lav);
    return 0;
  }

  if (categoria === "secadora") {
    if (cap === 10 && precos.sec10 != null) return Number(precos.sec10);
    if (cap === 15 && precos.sec15 != null) return Number(precos.sec15);
    // fallback antigo
    if (precos.sec != null) return Number(precos.sec);
    return 0;
  }

  // desconhecido: trata como lavadora (conservador)
  if (cap === 10 && precos.lav10 != null) return Number(precos.lav10);
  if (cap === 15 && precos.lav15 != null) return Number(precos.lav15);
  if (precos.lav != null) return Number(precos.lav);
  return 0;
}

async function fetchPrecosCondominio(sb: ReturnType<typeof supabaseAdmin>, condominioId: string): Promise<Precos> {
  // 1) tenta o modelo novo (por capacidade)
  const tentativaNova = await sb
    .from("condominios")
    .select(
      "id, valor_ciclo_lavadora_10, valor_ciclo_lavadora_15, valor_ciclo_secadora_10, valor_ciclo_secadora_15"
    )
    .eq("id", condominioId)
    .maybeSingle();

  if (!tentativaNova.error && tentativaNova.data) {
    const d: any = tentativaNova.data;
    return {
      lav10: d.valor_ciclo_lavadora_10 ?? null,
      lav15: d.valor_ciclo_lavadora_15 ?? null,
      sec10: d.valor_ciclo_secadora_10 ?? null,
      sec15: d.valor_ciclo_secadora_15 ?? null,
      lav: null,
      sec: null,
    };
  }

  // Se falhou por coluna inexistente ou qualquer erro, cai pro modelo antigo (não quebra produção)
  const tentativaAntiga = await sb
    .from("condominios")
    .select("id, valor_ciclo_lavadora, valor_ciclo_secadora")
    .eq("id", condominioId)
    .maybeSingle();

  if (tentativaAntiga.error) {
    // devolve tudo zerado (mas sem estourar)
    return { lav: 0, sec: 0, lav10: null, lav15: null, sec10: null, sec15: null };
  }

  return {
    lav: (tentativaAntiga.data as any)?.valor_ciclo_lavadora ?? 0,
    sec: (tentativaAntiga.data as any)?.valor_ciclo_secadora ?? 0,
    lav10: null,
    lav15: null,
    sec10: null,
    sec15: null,
  };
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

    const precos = await fetchPrecosCondominio(sb, aud.condominio_id);

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

      const valor_ciclo = pickValorCiclo(precos, categoria, capacidade_kg);

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

    const { data: aud, error: audErr } = await sb
      .from("auditorias")
      .select("id, condominio_id")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

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
