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

function safeMoney(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCategoria(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora" || s === "secadora") return s;
  return s || "lavadora";
}

function safeIntNonNeg(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function cleanUuidParam(raw: any) {
  // remove URL encoding e aspas
  let s = String(raw ?? "").trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  // remove aspas e caracteres "embrulhando"
  s = s.replace(/^[\s"'<>]+/, "").replace(/[\s"'<>]+$/, "");
  // remove aspas internas comuns de %22...%22
  s = s.replace(/^%22/, "").replace(/%22$/, "");
  // se ainda vier com aspas no meio
  s = s.replace(/^"+/, "").replace(/"+$/, "");
  return s;
}

type TipoPreco = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number;
  valor_ciclo: number | null;
};

async function getTiposDoCondominioComPreco(
  condominioId: string,
  fallback: { lav: number; sec: number }
) {
  const { data, error } = await supabaseAdmin()
    .from("condominio_maquinas")
    .select("categoria, capacidade_kg, valor_ciclo")
    .eq("condominio_id", condominioId);

  if (error) throw new Error(error.message);

  const map = new Map<string, TipoPreco>();

  for (const r of (data ?? []) as any[]) {
    const cat = normalizeCategoria(r.categoria) as "lavadora" | "secadora";
    const cap = safeNum(r.capacidade_kg);
    if (!cap) continue;

    const key = `${cat}-${cap}`;
    const val = r.valor_ciclo != null ? Number(r.valor_ciclo) : null;

    if (!map.has(key)) {
      map.set(key, { categoria: cat, capacidade_kg: Number(cap), valor_ciclo: val });
    } else {
      const cur = map.get(key)!;
      if ((cur.valor_ciclo == null || cur.valor_ciclo === 0) && val != null) {
        cur.valor_ciclo = val;
      }
    }
  }

  let tipos = Array.from(map.values());

  if (tipos.length === 0) {
    tipos = [{ categoria: "lavadora", capacidade_kg: 10, valor_ciclo: fallback.lav || 0 }];
  }

  tipos.sort((a, b) => {
    if (a.categoria !== b.categoria) return a.categoria === "lavadora" ? -1 : 1;
    return a.capacidade_kg - b.capacidade_kg;
  });

  tipos = tipos.map((t) => {
    if (t.valor_ciclo != null && Number.isFinite(t.valor_ciclo)) return t;
    const legacy = t.categoria === "secadora" ? fallback.sec : fallback.lav;
    return { ...t, valor_ciclo: Number(legacy ?? 0) };
  });

  return tipos;
}

function calcTotais(aud: any, condo: any, itens: any[]) {
  const receita_bruta = itens.reduce((acc, it) => {
    const ciclos = safeMoney(it?.ciclos);
    const valor = safeMoney(it?.valor_ciclo);
    return acc + ciclos * valor;
  }, 0);

  const cashback_percent = safeMoney(condo?.cashback_percent);
  const total_cashback = receita_bruta * (cashback_percent / 100);

  const agua_atual = safeNum(aud?.agua_leitura) ?? safeNum(aud?.leitura_agua);
  const energia_atual = safeNum(aud?.energia_leitura) ?? safeNum(aud?.leitura_energia);
  const gas_atual = safeNum(aud?.gas_leitura) ?? safeNum(aud?.leitura_gas);

  const agua_base = safeNum(aud?.agua_leitura_base) ?? safeNum(aud?.agua_base) ?? safeNum(aud?.base_agua);
  const energia_base =
    safeNum(aud?.energia_leitura_base) ?? safeNum(aud?.energia_base) ?? safeNum(aud?.base_energia);
  const gas_base = safeNum(aud?.gas_leitura_base) ?? safeNum(aud?.gas_base) ?? safeNum(aud?.base_gas);

  const consumo_agua =
    agua_atual != null && agua_base != null ? clampNonNeg(agua_atual - agua_base) : 0;
  const consumo_energia =
    energia_atual != null && energia_base != null ? clampNonNeg(energia_atual - energia_base) : 0;
  const consumo_gas =
    gas_atual != null && gas_base != null ? clampNonNeg(gas_atual - gas_base) : 0;

  const agua_valor_m3 = safeMoney(condo?.agua_valor_m3);
  const energia_valor_kwh = safeMoney(condo?.energia_valor_kwh);
  const gas_valor_m3 = safeMoney(condo?.gas_valor_m3);

  const total_repasse =
    consumo_agua * agua_valor_m3 +
    consumo_energia * energia_valor_kwh +
    consumo_gas * gas_valor_m3;

  const total_a_pagar = total_repasse + total_cashback;

  return {
    receita_bruta,
    cashback_percent,
    total_cashback,
    consumo_agua,
    consumo_energia,
    consumo_gas,
    total_repasse,
    total_a_pagar,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = cleanUuidParam(params.id);

    const { data: aud, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("*")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    const { data: condo, error: condoErr } = await supabaseAdmin()
      .from("condominios")
      .select("*")
      .eq("id", (aud as any).condominio_id)
      .maybeSingle();

    if (condoErr) return bad(condoErr.message, 500);

    const condoAny: any = condo ?? {};
    const fallback = {
      lav: condoAny.valor_ciclo_lavadora != null ? Number(condoAny.valor_ciclo_lavadora) : 0,
      sec: condoAny.valor_ciclo_secadora != null ? Number(condoAny.valor_ciclo_secadora) : 0,
    };

    const tipos = await getTiposDoCondominioComPreco(String((aud as any).condominio_id), fallback);

    const { data: rows, error: rowsErr } = await supabaseAdmin()
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos, created_at, updated_at")
      .eq("auditoria_id", auditoriaId);

    if (rowsErr) return bad(rowsErr.message, 500);

    const byKey = new Map<string, any>();
    for (const r of (rows ?? []) as any[]) {
      const cat = normalizeCategoria(r.categoria) as "lavadora" | "secadora";
      const cap = safeNum(r.capacidade_kg);
      if (!cap) continue;
      byKey.set(`${cat}-${cap}`, r);
    }

    const itens = tipos.map((t) => {
      const key = `${t.categoria}-${t.capacidade_kg}`;
      const r = byKey.get(key);
      return {
        id: r?.id ?? null,
        auditoria_id: auditoriaId,
        categoria: t.categoria,
        capacidade_kg: t.capacidade_kg,
        ciclos: Math.max(0, Number(r?.ciclos ?? 0)),
        valor_ciclo: Number(t.valor_ciclo ?? 0),
      };
    });

    const totais = calcTotais(aud, condoAny, itens);

    return NextResponse.json({
      ok: true,
      data: {
        auditoria: aud,
        itens,
        totais,
        receita_bruta: totais.receita_bruta,
        total_cashback: totais.total_cashback,
        total_repasse: totais.total_repasse,
        total_a_pagar: totais.total_a_pagar,
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

    const auditoriaId = cleanUuidParam(params.id);

    const body = await req.json().catch(() => null);
    const itensIn = Array.isArray(body?.itens) ? body.itens : null;
    if (!itensIn) return bad("Payload inválido. Esperado {itens:[...]}");

    const { data: aud, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("*")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) return bad(audErr.message, 500);
    if (!aud) return bad("Auditoria não encontrada", 404);

    const { data: condo, error: condoErr } = await supabaseAdmin()
      .from("condominios")
      .select("*")
      .eq("id", (aud as any).condominio_id)
      .maybeSingle();

    if (condoErr) return bad(condoErr.message, 500);

    const condoAny: any = condo ?? {};
    const fallback = {
      lav: condoAny.valor_ciclo_lavadora != null ? Number(condoAny.valor_ciclo_lavadora) : 0,
      sec: condoAny.valor_ciclo_secadora != null ? Number(condoAny.valor_ciclo_secadora) : 0,
    };

    const tipos = await getTiposDoCondominioComPreco(String((aud as any).condominio_id), fallback);
    const allowed = new Set<string>(tipos.map((t) => `${t.categoria}-${t.capacidade_kg}`));

    const rowsToUpsert: any[] = [];
    for (const raw of itensIn as any[]) {
      const cat = normalizeCategoria(raw?.categoria) as "lavadora" | "secadora";
      const cap = safeNum(raw?.capacidade_kg);
      if (!cap) return bad("Item inválido: capacidade_kg ausente/inválida", 400);

      const key = `${cat}-${cap}`;
      if (!allowed.has(key)) return bad(`Tipo não permitido para este condomínio: ${cat} ${cap}kg`, 400);

      rowsToUpsert.push({
        auditoria_id: auditoriaId,
        categoria: cat,
        capacidade_kg: Number(cap),
        ciclos: safeIntNonNeg(raw?.ciclos),
      });
    }

    const { error: upErr } = await supabaseAdmin()
      .from("auditoria_ciclos")
      .upsert(rowsToUpsert as any, { onConflict: "auditoria_id,categoria,capacidade_kg" });

    if (upErr) return bad(upErr.message, 500);

    const { data: rows, error: rowsErr } = await supabaseAdmin()
      .from("auditoria_ciclos")
      .select("id, auditoria_id, categoria, capacidade_kg, ciclos, created_at, updated_at")
      .eq("auditoria_id", auditoriaId);

    if (rowsErr) return bad(rowsErr.message, 500);

    const byKey = new Map<string, any>();
    for (const r of (rows ?? []) as any[]) {
      const cat = normalizeCategoria(r.categoria) as "lavadora" | "secadora";
      const cap = safeNum(r.capacidade_kg);
      if (!cap) continue;
      byKey.set(`${cat}-${cap}`, r);
    }

    const itens = tipos.map((t) => {
      const key = `${t.categoria}-${t.capacidade_kg}`;
      const r = byKey.get(key);
      return {
        id: r?.id ?? null,
        auditoria_id: auditoriaId,
        categoria: t.categoria,
        capacidade_kg: t.capacidade_kg,
        ciclos: Math.max(0, Number(r?.ciclos ?? 0)),
        valor_ciclo: Number(t.valor_ciclo ?? 0),
      };
    });

    const totais = calcTotais(aud, condoAny, itens);

    return NextResponse.json({
      ok: true,
      data: {
        auditoria: aud,
        itens,
        totais,
        receita_bruta: totais.receita_bruta,
        total_cashback: totais.total_cashback,
        total_repasse: totais.total_repasse,
        total_a_pagar: totais.total_a_pagar,
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
