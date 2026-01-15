export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function pickItens(body: any): any[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.itens)) return body.itens;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function isMissingColumn(errMsg: string, col: string) {
  const m = errMsg.toLowerCase();
  return m.includes(`column "${col.toLowerCase()}"`) && m.includes("does not exist");
}

async function insertWithOptionalColumns(
  supabase: any,
  table: string,
  rows: any[],
  optionalCols: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  let currentRows = rows.map((r) => ({ ...r }));

  for (let tries = 0; tries < optionalCols.length + 1; tries++) {
    const { error } = await supabase.from(table).insert(currentRows);
    if (!error) return { ok: true };

    const msg = String(error.message ?? error);
    let removedAny = false;

    for (const col of optionalCols) {
      if (isMissingColumn(msg, col)) {
        currentRows = currentRows.map((r) => {
          const cp = { ...r };
          delete cp[col];
          return cp;
        });
        removedAny = true;
      }
    }

    if (!removedAny) return { ok: false, error: msg };
  }

  return { ok: false, error: "Falha ao inserir (colunas opcionais)" };
}

/**
 * GET: a tela usa para carregar ciclos lançados
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getRole(supabase);
    if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const auditoriaId = params.id;

    const { data: itens, error: errItens } = await (supabase.from("auditoria_fechamento_itens") as any)
      .select("*")
      .eq("auditoria_id", auditoriaId);

    if (errItens) return NextResponse.json({ error: errItens.message }, { status: 400 });

    if ((itens ?? []).length > 0) {
      return NextResponse.json({ ok: true, source: "auditoria_fechamento_itens", itens });
    }

    const { data: legado, error: errLeg } = await (supabase.from("auditoria_ciclos") as any)
      .select("*")
      .eq("auditoria_id", auditoriaId);

    if (errLeg) return NextResponse.json({ error: errLeg.message }, { status: 400 });

    return NextResponse.json({ ok: true, source: "auditoria_ciclos", itens: legado ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST: salva ciclos do fechamento (Interno/Gestor)
 * ✅ Grava em auditoria_fechamento_itens (fonte usada pela view financeira).
 * A tabela exige maquina_tag NOT NULL, então a gente deriva:
 * - se vier maquina_tag, usa
 * - senão, se vier condominio_maquina_id/maquina_id, busca a tag no cadastro (condominio_maquinas)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getRole(supabase);
    if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const auditoriaId = params.id;

    const body = await req.json().catch(() => null);
    const itens = pickItens(body);
    if (!itens.length) return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });

    // auditoria -> condominio_id
    const { data: aud, error: audErr } = await (supabase.from("auditorias") as any)
      .select("id,condominio_id")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });

    // carrega máquinas do condomínio (mapa id<->tag)
    const { data: maquinas, error: maqErr } = await (supabase.from("condominio_maquinas") as any)
      .select("id,maquina_tag")
      .eq("condominio_id", aud.condominio_id);

    if (maqErr) return NextResponse.json({ error: maqErr.message }, { status: 400 });

    const tagById = new Map<string, string>();
    const idByTag = new Map<string, string>();
    for (const m of maquinas ?? []) {
      const id = String(m?.id ?? "").trim();
      const tag = String(m?.maquina_tag ?? "").trim();
      if (id && tag) {
        tagById.set(id, tag);
        idByTag.set(tag, id);
      }
    }

    // valida e normaliza
    const normalized = itens.map((it: any) => {
      const ciclos = Number(it?.ciclos ?? 0);
      if (!Number.isFinite(ciclos)) {
        return { ok: false as const, error: "ciclos inválido" };
      }

      const maybeTag = String(it?.maquina_tag ?? "").trim();
      const maybeId = String(it?.condominio_maquina_id ?? it?.maquina_id ?? it?.id ?? "").trim();

      // resolve tag + id
      let maquina_tag = maybeTag || "";
      let condominio_maquina_id = maybeId || "";

      if (!maquina_tag && condominio_maquina_id) {
        maquina_tag = tagById.get(condominio_maquina_id) ?? "";
      }
      if (!condominio_maquina_id && maquina_tag) {
        condominio_maquina_id = idByTag.get(maquina_tag) ?? "";
      }

      if (!maquina_tag) return { ok: false as const, error: "maquina_tag obrigatório (não consegui derivar pelo id)" };
      if (!condominio_maquina_id) return { ok: false as const, error: `máquina não encontrada no cadastro (tag: ${maquina_tag})` };

      return {
        ok: true as const,
        maquina_tag,
        condominio_maquina_id,
        ciclos: Math.trunc(ciclos),
      };
    });

    const firstBad = normalized.find((x: any) => !x.ok);
    if (firstBad && !firstBad.ok) {
      return NextResponse.json({ error: firstBad.error }, { status: 400 });
    }

    // idempotente: apaga e regrava
    const { error: delErr } = await (supabase.from("auditoria_fechamento_itens") as any)
      .delete()
      .eq("auditoria_id", auditoriaId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const rows = (normalized as any[])
      .filter((x) => x.ok)
      .map((x) => ({
        auditoria_id: auditoriaId,
        maquina_tag: x.maquina_tag, // NOT NULL
        condominio_maquina_id: x.condominio_maquina_id,
        ciclos: x.ciclos,
        // deixa null pra view usar valor_ciclo via join
        valor_total: null,
      }));

    // se o schema não tiver essas colunas opcionais, remove e tenta de novo
    const optionalCols = ["condominio_maquina_id", "valor_total"];
    const ins = await insertWithOptionalColumns(supabase as any, "auditoria_fechamento_itens", rows, optionalCols);
    if (!ins.ok) return NextResponse.json({ error: ins.error }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
