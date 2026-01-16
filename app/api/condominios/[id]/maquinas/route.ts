export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function toLower(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function normCategoria(x: any): "lavadora" | "secadora" {
  const s = toLower(x);
  if (s.includes("sec")) return "secadora";
  return "lavadora";
}

function safeNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n: any, fallback: number) {
  const x = Math.trunc(safeNumber(n, fallback));
  return x > 0 ? x : fallback;
}

async function canAuditorAccessByVinculo(auditorId: string, condominioId: string) {
  // tabela auditor_condominios = (auditor_id, condominio_id, created_at)
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("auditor_condominios")
    .select("auditor_id")
    .eq("condominio_id", condominioId)
    .eq("auditor_id", auditorId)
    .maybeSingle();

  if (error) return false;
  return !!data?.auditor_id;
}

function normalizeItens(body: any) {
  // Aceita:
  // 1) [ {...}, {...} ]
  // 2) { itens: [ ... ] }
  // 3) { data: { itens: [ ... ] } }
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.itens)) return body.itens;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data?.itens)) return body.data.itens;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  return [];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const condominioId = params.id;

    const isManager = roleGte(role as any, "interno");
    const isVinculado = role === "auditor" ? await canAuditorAccessByVinculo(user.id, condominioId) : false;

    if (!isManager && role === "auditor" && !isVinculado) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("condominio_maquinas")
      .select("categoria, capacidade_kg, quantidade, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos, maquina_tag")
      .eq("condominio_id", condominioId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, data: { itens: data ?? [] }, itens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const isManager = roleGte(role as any, "interno");
    if (!isManager) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const condominioId = params.id;
    const sb = supabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const itensRaw = normalizeItens(body);

    if (!itensRaw.length) {
      return NextResponse.json(
        { ok: false, error: "Payload vazio. Envie um array de máquinas OU {itens:[...]}" },
        { status: 400 }
      );
    }

    // Normaliza + dedup por (categoria,capacidade)
    const map = new Map<string, any>();

    for (const it of itensRaw) {
      const categoria = normCategoria(it?.categoria ?? it?.tipo ?? it?.maquina_tag);
      const capacidade_kg = it?.capacidade_kg === null || it?.capacidade_kg === undefined ? null : Number(it.capacidade_kg);

      if (!capacidade_kg || !Number.isFinite(capacidade_kg)) {
        return NextResponse.json({ ok: false, error: "capacidade_kg é obrigatório e numérico (ex: 10 ou 15)" }, { status: 400 });
      }

      const quantidade = clampInt(it?.quantidade, 1);
      const valor_ciclo = safeNumber(it?.valor_ciclo, 0);
      const limpeza_quimica_ciclos = clampInt(it?.limpeza_quimica_ciclos, 500);
      const limpeza_mecanica_ciclos = clampInt(it?.limpeza_mecanica_ciclos, 2000);

      const key = `${categoria}:${capacidade_kg}`;

      const prev = map.get(key);
      if (prev) {
        // Se vier duplicado, soma quantidade e mantém o último valor_ciclo (mais recente)
        map.set(key, {
          ...prev,
          quantidade: clampInt(prev.quantidade, 1) + quantidade,
          valor_ciclo,
          limpeza_quimica_ciclos,
          limpeza_mecanica_ciclos,
        });
      } else {
        map.set(key, {
          condominio_id: condominioId,
          categoria,
          capacidade_kg,
          quantidade,
          valor_ciclo,
          limpeza_quimica_ciclos,
          limpeza_mecanica_ciclos,
          // maquina_tag é NOT NULL no seu banco -> gera sempre
          maquina_tag: `${categoria}-${capacidade_kg}kg`,
        });
      }
    }

    const rows = Array.from(map.values());

    // Estratégia segura: faz "replace" com upsert e depois remove os que não estão mais
    // 1) upsert
    const { error: upErr } = await sb
      .from("condominio_maquinas")
      .upsert(rows, { onConflict: "condominio_id,categoria,capacidade_kg" });

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

    // 2) delete dos que sobraram (para refletir exatamente a UI)
    const keepKeys = rows.map((r) => `${r.categoria}:${r.capacidade_kg}`);
    const { data: existing, error: exErr } = await sb
      .from("condominio_maquinas")
      .select("categoria,capacidade_kg")
      .eq("condominio_id", condominioId);

    if (!exErr && Array.isArray(existing)) {
      const toDelete = existing.filter((r: any) => !keepKeys.includes(`${r.categoria}:${r.capacidade_kg}`));
      for (const d of toDelete) {
        await sb
          .from("condominio_maquinas")
          .delete()
          .eq("condominio_id", condominioId)
          .eq("categoria", d.categoria)
          .eq("capacidade_kg", d.capacidade_kg);
      }
    }

    // retorna o estado final
    const { data, error } = await sb
      .from("condominio_maquinas")
      .select("categoria, capacidade_kg, quantidade, valor_ciclo, limpeza_quimica_ciclos, limpeza_mecanica_ciclos, maquina_tag")
      .eq("condominio_id", condominioId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (error) return NextResponse.json({ ok: true, data: { itens: [] }, itens: [] }, { status: 200 });

    return NextResponse.json({ ok: true, data: { itens: data ?? [] }, itens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}
