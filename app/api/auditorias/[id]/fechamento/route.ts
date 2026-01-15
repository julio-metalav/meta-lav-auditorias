export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";
type TipoPagamento = "direto" | "boleto";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia" || s === "em-conferencia" || s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento" || s === "em-andamento" || s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

function normalizeTipoPagamento(input: any): TipoPagamento {
  const s = String(input ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

function numOr0(v: any): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function intOr0(v: any): number {
  const n = Number(String(v ?? "").replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function textOrNull(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function mustId(params: any) {
  const id = String(params?.id ?? "").trim();
  if (!id) throw new Error("ID de auditoria ausente.");
  return id;
}

async function loadAuditoria(admin: ReturnType<typeof supabaseAdmin>, auditoriaId: string) {
  const { data, error } = await admin
    .from("auditorias")
    .select(
      "id,status,fechamento_obs,fechado_por,fechado_em,comprovante_fechamento_url,condominio_id,mes_ref,auditor_id"
    )
    .eq("id", auditoriaId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Auditoria não encontrada.");
  return data as any;
}

async function loadItens(admin: ReturnType<typeof supabaseAdmin>, auditoriaId: string) {
  const { data, error } = await admin
    .from("auditoria_fechamento_itens")
    .select("*")
    .eq("auditoria_id", auditoriaId)
    .order("maquina_tag", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

async function loadTipoPagamentoCondominio(
  admin: ReturnType<typeof supabaseAdmin>,
  condominioId: string
): Promise<TipoPagamento> {
  if (!condominioId) return "direto"; // fallback seguro

  const { data, error } = await admin
    .from("condominios")
    .select("id,tipo_pagamento")
    .eq("id", condominioId)
    .maybeSingle();

  // Se der erro ou não achar, assume DIRETO (regra mais rígida, não quebra compliance)
  if (error || !data) return "direto";
  return normalizeTipoPagamento((data as any)?.tipo_pagamento);
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão (apenas Interno/Gestor)." }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const auditoriaId = mustId(params);
    const [auditoria, itens] = await Promise.all([loadAuditoria(admin, auditoriaId), loadItens(admin, auditoriaId)]);

    return NextResponse.json({ auditoria, itens });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST = cria OU atualiza 1 item
 * body:
 * - opcional: id (se vier, faz update)
 * - maquina_tag (obrigatório)
 * - tipo (opcional)
 * - ciclos (obrigatório >= 0)
 * - valor_total (opcional)
 * - valor_repasse (opcional)
 * - valor_cashback (opcional)
 * - observacoes (opcional)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão (apenas Interno/Gestor)." }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const auditoriaId = mustId(params);
    const body = await req.json().catch(() => ({}));

    const itemId = textOrNull(body?.id);
    const maquina_tag = String(body?.maquina_tag ?? "").trim();
    const tipo = String(body?.tipo ?? "lavadora").trim() || "lavadora";
    const ciclos = intOr0(body?.ciclos);

    if (!maquina_tag) {
      return NextResponse.json({ error: "Campo obrigatório: maquina_tag (ex: LAV-01)" }, { status: 400 });
    }

    const row: any = {
      auditoria_id: auditoriaId,
      maquina_tag,
      tipo,
      ciclos,
      valor_total: numOr0(body?.valor_total),
      valor_repasse: numOr0(body?.valor_repasse),
      valor_cashback: numOr0(body?.valor_cashback),
      observacoes: textOrNull(body?.observacoes),
    };

    // valida auditoria existe
    await loadAuditoria(admin, auditoriaId);

    let saved: any = null;

    if (itemId) {
      // update
      const { data, error } = await admin
        .from("auditoria_fechamento_itens")
        .update({
          maquina_tag: row.maquina_tag,
          tipo: row.tipo,
          ciclos: row.ciclos,
          valor_total: row.valor_total,
          valor_repasse: row.valor_repasse,
          valor_cashback: row.valor_cashback,
          observacoes: row.observacoes,
        })
        .eq("id", itemId)
        .eq("auditoria_id", auditoriaId)
        .select("*")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      saved = data;
    } else {
      // insert
      const { data, error } = await admin.from("auditoria_fechamento_itens").insert(row).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      saved = data;
    }

    // devolve visão completa (pra UI ficar simples)
    const [auditoria, itens] = await Promise.all([loadAuditoria(admin, auditoriaId), loadItens(admin, auditoriaId)]);
    return NextResponse.json({ ok: true, item: saved, auditoria, itens });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * DELETE /fechamento?item_id=uuid
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão (apenas Interno/Gestor)." }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const auditoriaId = mustId(params);
    const url = new URL(req.url);
    const itemId = String(url.searchParams.get("item_id") ?? "").trim();
    if (!itemId) return NextResponse.json({ error: "Informe item_id na querystring." }, { status: 400 });

    const { error } = await admin
      .from("auditoria_fechamento_itens")
      .delete()
      .eq("id", itemId)
      .eq("auditoria_id", auditoriaId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const [auditoria, itens] = await Promise.all([loadAuditoria(admin, auditoriaId), loadItens(admin, auditoriaId)]);
    return NextResponse.json({ ok: true, auditoria, itens });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * PATCH = FINALIZAR auditoria (status=final)
 * body:
 * - fechamento_obs (opcional)
 * - comprovante_fechamento_url (opcional)  <-- normalmente vem do upload /fotos kind=comprovante_fechamento
 *
 * Regras:
 * - precisa ter pelo menos 1 item
 * - comprovante só é obrigatório se tipo_pagamento do condomínio = 'direto'
 * - se já estiver final, retorna ok sem refazer
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão (apenas Interno/Gestor)." }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const auditoriaId = mustId(params);
    const body = await req.json().catch(() => ({}));

    const auditoria = await loadAuditoria(admin, auditoriaId);
    const statusAtual = normalizeStatus(auditoria.status);

    if (statusAtual === "final") {
      const itens = await loadItens(admin, auditoriaId);
      return NextResponse.json({ ok: true, auditoria, itens, note: "Já estava final." });
    }

    // precisa ter itens
    const itens = await loadItens(admin, auditoriaId);
    if (!itens.length) {
      return NextResponse.json(
        { error: "Não é possível finalizar sem itens de fechamento (máquinas)." },
        { status: 400 }
      );
    }

    // regra nova: exige comprovante só se pagamento direto
    const tipoPagamento = await loadTipoPagamentoCondominio(admin, String(auditoria.condominio_id ?? ""));
    const exigeComprovante = tipoPagamento === "direto";

    const comprovanteBody = textOrNull(body?.comprovante_fechamento_url);
    const comprovanteSaved = textOrNull(auditoria.comprovante_fechamento_url);
    const comprovante = comprovanteBody ?? comprovanteSaved;

    if (exigeComprovante && !comprovante) {
      return NextResponse.json(
        { error: "Envie o comprovante de fechamento antes de finalizar (pagamento direto)." },
        { status: 400 }
      );
    }

    const fechamento_obs = textOrNull(body?.fechamento_obs);

    const { data: updated, error } = await admin
      .from("auditorias")
      .update({
        fechamento_obs,
        // se boleto e não tiver comprovante, salva null mesmo (pode finalizar sem)
        comprovante_fechamento_url: comprovante ?? null,
        status: "final",
        fechado_por: ctx.user.id,
        fechado_em: new Date().toISOString(),
      })
      .eq("id", auditoriaId)
      .select(
        "id,status,fechamento_obs,fechado_por,fechado_em,comprovante_fechamento_url,condominio_id,mes_ref,auditor_id"
      )
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const itens2 = await loadItens(admin, auditoriaId);
    return NextResponse.json({
      ok: true,
      auditoria: updated,
      itens: itens2,
      meta: { tipo_pagamento: tipoPagamento, exige_comprovante: exigeComprovante },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
