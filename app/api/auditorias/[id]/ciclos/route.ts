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
  return errMsg.toLowerCase().includes(`column "${col.toLowerCase()}"`) && errMsg.toLowerCase().includes("does not exist");
}

async function insertWithOptionalColumns(
  supabase: any,
  table: string,
  rows: any[],
  optionalCols: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  // tenta inserir; se reclamar de coluna inexistente, remove e tenta de novo
  let currentRows = rows.map((r) => ({ ...r }));

  for (let tries = 0; tries < optionalCols.length + 1; tries++) {
    const { error } = await supabase.from(table).insert(currentRows);
    if (!error) return { ok: true };

    const msg = String(error.message ?? error);
    // remove colunas opcionais que não existirem
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
 * - Principal: auditoria_fechamento_itens (fonte do financeiro)
 * - Fallback: auditoria_ciclos (legado)
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

    const { data: ciclosLegado, error: errLeg } = await (supabase.from("auditoria_ciclos") as any)
      .select("*")
      .eq("auditoria_id", auditoriaId);

    if (errLeg) return NextResponse.json({ error: errLeg.message }, { status: 400 });

    return NextResponse.json({ ok: true, source: "auditoria_ciclos", itens: ciclosLegado ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST: salva ciclos do fechamento (Interno/Gestor)
 * ✅ Grava em auditoria_fechamento_itens, com maquina_tag (NOT NULL) e condominio_maquina_id (para calcular valor via valor_ciclo).
 *
 * A tela já envia itens com:
 * - maquina_tag
 * - ciclos
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

    // auditoria -> condominio_id (pra mapear maquina_tag -> id da máquina)
    const { data: aud, error: audErr } = await (supabase.from("auditorias") as any)
      .select("id,condominio_id")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });

    // mapa tag -> id
    const { data: maquinas, error: maqErr } = await (supabase.from("condominio_maquinas") as any)
      .select("id,maquina_tag")
      .eq("condominio_id", aud.condominio_id);

    if (maqErr) return NextResponse.json({ error: maqErr.message }, { status: 400 });

    const idByTag = new Map<string, string>();
    for (const m of maquinas ?? []) {
      const tag = String(m?.maquina_tag ?? "").trim();
      const id = String(m?.id ?? "").trim();
      if (tag && id) idByTag.set(tag, id);
    }

    // valida mínimo
    for (const it of itens) {
      const tag = String(it?.maquina_tag ?? "").trim();
      if (!tag) return NextResponse.json({ error: "maquina_tag obrigatório" }, { status: 400 });

      const ciclos = Number(it?.ciclos ?? 0);
      if (Number.isNaN(ciclos)) return NextResponse.json({ error: "ciclos inválido" }, { status: 400 });

      if (!idByTag.has(tag)) {
        return NextResponse.json({ error: `maquina_tag não encontrada no cadastro do condomínio: ${tag}` }, { status: 400 });
      }
    }

    // idempotente: apaga tudo e regrava
    const { error: delErr } = await (supabase.from("auditoria_fechamento_itens") as any)
      .delete()
      .eq("auditoria_id", auditoriaId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const rows = itens.map((it: any) => {
      const tag = String(it.maquina_tag).trim();
      const ciclos = Number(it?.ciclos ?? 0);
      const condominio_maquina_id = idByTag.get(tag) ?? null;

      // valor_total fica null para usar valor_ciclo via join (view atual)
      return {
        auditoria_id: auditoriaId,
        maquina_tag: tag,
        condominio_maquina_id,
        ciclos: Number.isFinite(ciclos) ? ciclos : 0,
        valor_total: null,
      };
    });

    // algumas colunas podem não existir dependendo do seu schema; a função abaixo remove se precisar
    const optionalCols = ["condominio_maquina_id", "valor_total"];
    const ins = await insertWithOptionalColumns(supabase as any, "auditoria_fechamento_itens", rows, optionalCols);
    if (!ins.ok) return NextResponse.json({ error: ins.error }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
