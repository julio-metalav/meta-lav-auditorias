export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

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

function normCategoria(v: any): "lavadora" | "secadora" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora") return "lavadora";
  if (s === "secadora") return "secadora";
  return null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/* =========================
   POST – salvar máquinas
========================= */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const role = ctx.role as Role | null;

  // 🔴 FIX: nunca passar null para roleGte
  if (!role || !roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  try {
    const condominioId = String(params?.id ?? "").trim();
    if (!condominioId) {
      return NextResponse.json({ error: "ID do condomínio ausente." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);

    const list = Array.isArray(body)
      ? body
      : Array.isArray(body?.maquinas)
        ? body.maquinas
        : [];

    let lavN = 0;
    let secN = 0;

    const rows = list
      .map((m: any) => {
        const categoria = normCategoria(m?.categoria ?? m?.tipo);
        if (!categoria) return null;

        const quantidade = Math.max(1, intOr(m?.quantidade, 1));

        const capacidade_kg = numOrNull(m?.capacidade_kg);
        const valor_ciclo = numOrNull(m?.valor_ciclo);
        const limpeza_quimica_ciclos = Math.max(1, intOr(m?.limpeza_quimica_ciclos, 500));
        const limpeza_mecanica_ciclos = Math.max(1, intOr(m?.limpeza_mecanica_ciclos, 2000));

        let maquina_tag = String(m?.maquina_tag ?? "").trim();
        if (!maquina_tag) {
          if (categoria === "lavadora") lavN += 1;
          else secN += 1;
          maquina_tag = categoria === "lavadora"
            ? `LAV-${pad2(lavN)}`
            : `SEC-${pad2(secN)}`;
        }

        return {
          condominio_id: condominioId,
          categoria,
          capacidade_kg,
          quantidade,
          valor_ciclo,
          limpeza_quimica_ciclos,
          limpeza_mecanica_ciclos,
          maquina_tag,
          ativo: m?.ativo === false ? false : true,
        };
      })
      .filter(Boolean) as any[];

    const totalQtd = rows.reduce((acc, r) => acc + (Number(r.quantidade) || 0), 0);
    if (!rows.length || totalQtd <= 0) {
      return NextResponse.json(
        { error: "Nenhuma máquina válida para salvar (quantidade > 0)." },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from("condominio_maquinas")
      .delete()
      .eq("condominio_id", condominioId);

    const { data, error } = await supabaseAdmin
      .from("condominio_maquinas")
      .insert(rows)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/* =========================
   GET – listar máquinas
========================= */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const role = ctx.role as Role | null;
  if (!role || !roleGte(role, "auditor")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const condominioId = String(params?.id ?? "").trim();
  if (!condominioId) {
    return NextResponse.json({ error: "ID do condomínio ausente." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("condominio_maquinas")
    .select("*")
    .eq("condominio_id", condominioId)
    .order("categoria")
    .order("maquina_tag");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data });
}
