// app/api/condominios/[id]/maquinas/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function mustId(params: any) {
  const id = String(params?.id ?? "").trim();
  if (!id) throw new Error("ID do condomínio ausente.");
  return id;
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function intOr(v: any, fallback: number) {
  const n = Number(String(v ?? "").replace(/[^\d-]/g, ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normCategoria(v: any): "lavadora" | "secadora" {
  const s = String(v ?? "lavadora").trim().toLowerCase();
  return s === "secadora" ? "secadora" : "lavadora";
}

function makeTag(prefix: "LAV" | "SEC", n: number) {
  return `${prefix}-${String(n).padStart(2, "0")}`;
}

function parseTagNumber(tag: string): number | null {
  // aceita LAV-01, LAV-1, SEC-12
  const m = String(tag ?? "").trim().match(/-(\d{1,4})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET: lista máquinas do condomínio
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

 const role = ctx.role as Role | null;

if (!role || !roleGte(role, "auditor")) {
  return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
}


  try {
    const condominioId = mustId(params);

    const { data, error } = await ctx.supabase
      .from("condominio_maquinas")
      .select("id,condominio_id,categoria,maquina_tag,capacidade_kg,valor_ciclo,limpeza_quimica_ciclos,limpeza_mecanica_ciclos,created_at")
      .eq("condominio_id", condominioId)
      .order("categoria", { ascending: true })
      .order("maquina_tag", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, data: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST: replace das máquinas do condomínio
 *
 * Aceita:
 * - array de "tipos", com quantidade (tela atual manda assim)
 *   [{categoria, capacidade_kg, quantidade, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos}]
 *
 * Regra:
 * - se vier sem maquina_tag (normal no cadastro), o backend gera:
 *   LAV-01.. e SEC-01.., respeitando quantidade
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = ctx.role as Role | null;

if (!role || !roleGte(role, "auditor")) {
  return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
}


  try {
    const condominioId = mustId(params);
    const body = await req.json().catch(() => null);

    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Body deve ser um array de máquinas." }, { status: 400 });
    }

    // 1) busca o que já existe (pra gerar sequência estável)
    const { data: existing, error: e1 } = await ctx.supabase
      .from("condominio_maquinas")
      .select("id,categoria,maquina_tag")
      .eq("condominio_id", condominioId);

    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    let maxLav = 0;
    let maxSec = 0;

    (existing ?? []).forEach((r: any) => {
      const cat = normCategoria(r?.categoria);
      const n = parseTagNumber(String(r?.maquina_tag ?? ""));
      if (!n) return;
      if (cat === "lavadora") maxLav = Math.max(maxLav, n);
      if (cat === "secadora") maxSec = Math.max(maxSec, n);
    });

    // 2) monta rows (expande quantidade)
    const rows: any[] = [];
    let nextLav = maxLav + 1;
    let nextSec = maxSec + 1;

    for (const item of body) {
      const categoria = normCategoria(item?.categoria);
      const qtd = Math.max(0, intOr(item?.quantidade, 0));
      if (qtd <= 0) continue; // se usuário deixou 0, ignora

      const capacidade_kg = numOrNull(item?.capacidade_kg);
      const valor_ciclo = numOrNull(item?.valor_ciclo);
      const limpeza_quimica_ciclos = Math.max(1, intOr(item?.limpeza_quimica_ciclos, 500));
      const limpeza_mecanica_ciclos = Math.max(1, intOr(item?.limpeza_mecanica_ciclos, 2000));

      for (let i = 0; i < qtd; i++) {
        const tag =
          categoria === "lavadora"
            ? makeTag("LAV", nextLav++)
            : makeTag("SEC", nextSec++);

        rows.push({
          condominio_id: condominioId,
          categoria,
          maquina_tag: tag,
          capacidade_kg,
          valor_ciclo,
          limpeza_quimica_ciclos,
          limpeza_mecanica_ciclos,
        });
      }
    }

    if (!rows.length) {
      return NextResponse.json({ error: "Nenhuma máquina válida para salvar (quantidade > 0)." }, { status: 400 });
    }

    // 3) replace (delete + insert)
    const { error: eDel } = await ctx.supabase.from("condominio_maquinas").delete().eq("condominio_id", condominioId);
    if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });

    const { data: saved, error: eIns } = await ctx.supabase
      .from("condominio_maquinas")
      .insert(rows)
      .select("id,condominio_id,categoria,maquina_tag,capacidade_kg,valor_ciclo,limpeza_quimica_ciclos,limpeza_mecanica_ciclos");

    if (eIns) return NextResponse.json({ error: eIns.message }, { status: 400 });

    return NextResponse.json({ ok: true, data: saved ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
