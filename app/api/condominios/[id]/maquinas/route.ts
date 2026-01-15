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

function hasQuantidade(v: any) {
  return !(v === undefined || v === null || v === "");
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

function tagSortKey(tag: string): number {
  // LAV-01, SEC-12 etc
  const n = parseTagNumber(tag);
  return n ?? 0;
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
      .select(
        "id,condominio_id,categoria,maquina_tag,capacidade_kg,quantidade,valor_ciclo,limpeza_quimica_ciclos,limpeza_mecanica_ciclos,ativo,created_at"
      )
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
 * - array de máquinas (tela atual manda assim)
 *   [{categoria, capacidade_kg, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos, (quantidade?)}]
 *
 * Compat:
 * - se vier "quantidade", expande.
 * - se NÃO vier "quantidade" (caso atual), cada item vale 1 máquina.
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

    // 1) busca o que já existe (pra manter tags estáveis entre saves)
    const { data: existing, error: e1 } = await ctx.supabase
      .from("condominio_maquinas")
      .select("id,categoria,maquina_tag")
      .eq("condominio_id", condominioId);

    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    // tags existentes por categoria
    const existingLavTags = (existing ?? [])
      .filter((r: any) => normCategoria(r?.categoria) === "lavadora")
      .map((r: any) => String(r?.maquina_tag ?? "").trim())
      .filter(Boolean)
      .sort((a: string, b: string) => tagSortKey(a) - tagSortKey(b));

    const existingSecTags = (existing ?? [])
      .filter((r: any) => normCategoria(r?.categoria) === "secadora")
      .map((r: any) => String(r?.maquina_tag ?? "").trim())
      .filter(Boolean)
      .sort((a: string, b: string) => tagSortKey(a) - tagSortKey(b));

    let maxLav = 0;
    let maxSec = 0;
    for (const t of existingLavTags) maxLav = Math.max(maxLav, parseTagNumber(t) ?? 0);
    for (const t of existingSecTags) maxSec = Math.max(maxSec, parseTagNumber(t) ?? 0);

    // 2) monta rows (expande quantidade se vier; caso não venha, cada item vale 1)
    const rows: any[] = [];
    let nextLav = maxLav + 1;
    let nextSec = maxSec + 1;
    let iLav = 0;
    let iSec = 0;

    for (const item of body) {
      const categoria = normCategoria(item?.categoria ?? item?.tipo);

      // caso atual: UI NÃO manda quantidade => 1
      // se mandar quantidade no futuro, expande
      const qtd = hasQuantidade(item?.quantidade) ? Math.max(0, intOr(item?.quantidade, 0)) : 1;
      if (qtd <= 0) continue; // se usuário colocou 0 explicitamente, ignora

      const capacidade_kg = numOrNull(item?.capacidade_kg);
      const valor_ciclo = numOrNull(item?.valor_ciclo);
      const limpeza_quimica_ciclos = Math.max(1, intOr(item?.limpeza_quimica_ciclos, 500));
      const limpeza_mecanica_ciclos = Math.max(1, intOr(item?.limpeza_mecanica_ciclos, 2000));

      for (let i = 0; i < qtd; i++) {
        let tag = "";

        if (categoria === "lavadora") {
          tag = existingLavTags[iLav] || makeTag("LAV", nextLav++);
          iLav += 1;
        } else {
          tag = existingSecTags[iSec] || makeTag("SEC", nextSec++);
          iSec += 1;
        }

        rows.push({
          condominio_id: condominioId,
          categoria,
          maquina_tag: tag, // NOT NULL no banco
          capacidade_kg,
          quantidade: 1, // cada item é 1 máquina (modelo atual)
          valor_ciclo,
          limpeza_quimica_ciclos,
          limpeza_mecanica_ciclos,
          ativo: true,
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
      .select(
        "id,condominio_id,categoria,maquina_tag,capacidade_kg,quantidade,valor_ciclo,limpeza_quimica_ciclos,limpeza_mecanica_ciclos,ativo"
      );

    if (eIns) return NextResponse.json({ error: eIns.message }, { status: 400 });

    return NextResponse.json({ ok: true, data: saved ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
