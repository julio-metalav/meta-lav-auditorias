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

function pickValorCicloByCapacidade(opts: {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number | null;
  // novo
  lav10?: number | null;
  lav15?: number | null;
  sec10?: number | null;
  sec15?: number | null;
  // legado
  lavLegacy?: number | null;
  secLegacy?: number | null;
}) {
  const { categoria, capacidade_kg } = opts;
  const cap = capacidade_kg ?? null;

  if (categoria === "lavadora") {
    if (cap === 15 && opts.lav15 != null) return Number(opts.lav15);
    if (cap === 10 && opts.lav10 != null) return Number(opts.lav10);
    // fallback novo: se só um existir, usa ele
    if (cap === 15 && opts.lav10 != null && opts.lav15 == null) return Number(opts.lav10);
    if (cap === 10 && opts.lav15 != null && opts.lav10 == null) return Number(opts.lav15);
    // legado
    return Number(opts.lavLegacy ?? 0);
  }

  // secadora
  if (cap === 15 && opts.sec15 != null) return Number(opts.sec15);
  if (cap === 10 && opts.sec10 != null) return Number(opts.sec10);
  if (cap === 15 && opts.sec10 != null && opts.sec15 == null) return Number(opts.sec10);
  if (cap === 10 && opts.sec15 != null && opts.sec10 == null) return Number(opts.sec15);
  return Number(opts.secLegacy ?? 0);
}

async function getTiposDoCondominio(condominioId: string) {
  // “O que aparece” vem do cadastro de máquinas do condomínio
  // distinct categoria + capacidade_kg
  const { data, error } = await supabaseAdmin()
    .from("condominio_maquinas")
    .select("categoria, capacidade_kg")
    .eq("condominio_id", condominioId);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const tipos: { categoria: "lavadora" | "secadora"; capacidade_kg: number }[] = [];

  for (const r of data ?? []) {
    const cat = normalizeCategoria(r.categoria) as "lavadora" | "secadora";
    const cap = safeNum(r.capacidade_kg);
    if (!cap) continue;
    const key = `${cat}-${cap}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tipos.push({ categoria: cat, capacidade_kg: Number(cap) });
  }

  // se por algum motivo o condomínio ainda não cadastrou máquinas,
  // devolve um default mínimo (lavadora 10) pra não quebrar a tela.
  if (tipos.length === 0) {
    tipos.push({ categoria: "lavadora", capacidade_kg: 10 });
  }

  // ordena: lavadora antes, e 10 antes de 15
  tipos.sort((a, b) => {
    if (a.categoria !== b.categoria) return a.categoria === "lavadora" ? -1 : 1;
    return a.capacidade_kg - b.capacidade_kg;
  });

  return tipos;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = params.id;

    const { data: aud, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    const { data: condo, error: condoErr } = await supabaseAdmin()
      .from("condominios")
      .select(
        [
          "id",
          // legado
          "valor_ciclo_lavadora",
          "valor_ciclo_secadora",
          // novo
          "valor_ciclo_lavadora_10",
          "valor_ciclo_lavadora_15",
          "valor_ciclo_secadora_10",
          "valor_ciclo_secadora_15",
        ].join(",")
      )
      .eq("id", aud.condominio_id)
      .maybeSingle();

    if (condoErr) return bad(condoErr.message, 500);

    const precos = {
      lavLegacy: condo?.valor_ciclo_lavadora != null ? Number(condo.valor_ciclo_lavadora) : 0,
      secLegacy: condo?.valor_ciclo_secadora != null ? Number(condo.valor_ciclo_secadora) : 0,
      lav10: condo?.valor_ciclo_lavadora_10 != null ? Number(condo.valor_ciclo_lavadora_10) : null,
      lav15: condo?.valor_ciclo_lavadora_15 != null ? Number(condo.valor_ciclo_lavadora_15) : null,
      sec10: condo?.valor_ciclo_secadora_10 != null ? Number(condo.valor_ciclo_secadora_10) : null,
      sec15: condo?.valor_ciclo_secadora_15 != null ? Number(condo.valor_ciclo_secadora_15) : null,
    };

    const tipos = await getTiposDoCondominio(String(aud.condominio_id));

    const { data: rows, error: rowsErr } = await supabaseAdmin()
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos, created_at, updated_at")
      .eq("auditoria_id", auditoriaId);

    if (rowsErr) return bad(rowsErr.message, 500);

    const byKey = new Map<string, any>();
    for (const r of rows ?? []) {
      const cat = normalizeCategoria(r.categoria) as "lavadora" | "secadora";
      const cap = safeNum(r.capacidade_kg);
      if (!cap) continue;
      byKey.set(`${cat}-${cap}`, r);
    }

    const itens = tipos.map((t) => {
      const key = `${t.categoria}-${t.capacidade_kg}`;
      const r = byKey.get(key);

      const valor_ciclo = pickValorCicloByCapacidade({
        categoria: t.categoria,
        capacidade_kg: t.capacidade_kg,
        lav10: precos.lav10,
        lav15: precos.lav15,
        sec10: precos.sec10,
        sec15: precos.sec15,
        lavLegacy: precos.lavLegacy,
        secLegacy: precos.secLegacy,
      });

      return {
        id: r?.id ?? null,
        auditoria_id: auditoriaId,
        categoria: t.categoria,
        capacidade_kg: t.capacidade_kg,
        ciclos: Math.max(0, Number(r?.ciclos ?? 0)),
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

    const { data: aud, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    // opcional: valida contra tipos cadastrados no condomínio
    const tipos = await getTiposDoCondominio(String(aud.condominio_id));
    const allowed = new Set(tipos.map((t) => `${t.categoria}-${t.capacidade_kg}`));

    const normalized = itens.map((x: any) => {
      const categoria = normalizeCategoria(x.categoria) as "lavadora" | "secadora";
      const capacidade_kg = safeNum(x.capacidade_kg);
      const ciclos = safeNum(x.ciclos);

      if (!categoria) throw new Error("categoria obrigatória");
      if (capacidade_kg === null) throw new Error("capacidade_kg obrigatória");
      if (ciclos === null) throw new Error("ciclos obrigatório");

      const key = `${categoria}-${Number(capacidade_kg)}`;
      if (!allowed.has(key)) {
        throw new Error(`Tipo não cadastrado no condomínio: ${categoria} ${Number(capacidade_kg)}kg`);
      }

      return {
        auditoria_id: auditoriaId,
        categoria,
        capacidade_kg: Number(capacidade_kg),
        ciclos: Math.max(0, Math.trunc(Number(ciclos))),
      };
    });

    const { error: upErr } = await supabaseAdmin()
      .from("auditoria_ciclos")
      .upsert(normalized, { onConflict: "auditoria_id,categoria,capacidade_kg" });

    if (upErr) return bad(upErr.message, 500);

    const { data: after, error: afterErr } = await supabaseAdmin()
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
