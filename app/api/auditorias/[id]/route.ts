export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

type AudRow = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  mes_ref: string | null;
  status: Status | string | null;

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  agua_leitura_base?: number | null;
  energia_leitura_base?: number | null;
  gas_leitura_base?: number | null;
  leitura_base_origem?: string | null;

  observacoes?: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;
  foto_quimicos_url?: string | null;
  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  comprovante_fechamento_url?: string | null;
  fechamento_obs?: string | null;
  fechado_por?: string | null;
  fechado_em?: string | null;
};

type CondoRow = {
  id: string;
  nome?: string | null;
  cidade?: string | null;
  uf?: string | null;

  usa_gas?: boolean | null;
  tarifa_agua_m3?: number | null;
  tarifa_energia_kwh?: number | null;
  tarifa_gas_m3?: number | null;

  cashback_percent?: number | null;

  banco_nome?: string | null;
  banco_agencia?: string | null;
  banco_conta?: string | null;
  banco_pix?: string | null;

  pagamento_metodo?: string | null;
  tipo_pagamento?: string | null;
};

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia" || s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento" || s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

function textOrNull(v: any): string | null {
  const t = String(v ?? "").trim();
  return t ? t : null;
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const AUD_SELECT =
  "id,condominio_id,auditor_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,agua_leitura_base,energia_leitura_base,gas_leitura_base,leitura_base_origem,observacoes,foto_agua_url,foto_energia_url,foto_gas_url,foto_quimicos_url,foto_bombonas_url,foto_conector_bala_url,comprovante_fechamento_url,fechamento_obs,fechado_por,fechado_em";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

/**
 * Auditor pode acessar a auditoria se:
 * - for interno/gestor, OU
 * - auditor_id bate com o user.id (ou user.email), OU
 * - auditor_id é NULL e existe vínculo na tabela auditor_condominios para aquele condominio
 */
async function canAuditorAccessByVinculo(
  admin: ReturnType<typeof supabaseAdmin>,
  auditorUserId: string,
  condominioId: string
): Promise<boolean> {
  // tabela esperada: auditor_condominios(auditor_id uuid, condominio_id uuid)
  const { data, error } = await (admin.from("auditor_condominios") as any)
    .select("auditor_id,condominio_id")
    .eq("auditor_id", auditorUserId)
    .eq("condominio_id", condominioId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

// ---------- GET ----------
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const admin = supabaseAdmin();

    const id = params.id;

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const user = auth.user;
    const role = await getUserRole(supabase);

    const { data, error } = await (admin.from("auditorias") as any).select(AUD_SELECT).eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    const aud = data as AudRow;

    const isManager = roleGte(role, "interno");

    const isOwnerAuditor =
      !!aud.auditor_id && (aud.auditor_id === user.id || aud.auditor_id === user.email);

    const isLinkedAuditor =
      !aud.auditor_id ? await canAuditorAccessByVinculo(admin, user.id, aud.condominio_id) : false;

    if (!isManager && !isOwnerAuditor && !isLinkedAuditor) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    let condominio: CondoRow | null = null;
    try {
      const { data: c } = await (admin.from("condominios") as any)
        .select(
          [
            "id",
            "nome",
            "cidade",
            "uf",
            "usa_gas",
            "tarifa_agua_m3",
            "tarifa_energia_kwh",
            "tarifa_gas_m3",
            "cashback_percent",
            "banco_nome",
            "banco_agencia",
            "banco_conta",
            "banco_pix",
            "pagamento_metodo",
            "tipo_pagamento",
          ].join(",")
        )
        .eq("id", aud.condominio_id)
        .maybeSingle();
      condominio = (c ?? null) as any;
    } catch {
      // best-effort
    }

    return NextResponse.json({
      auditoria: aud,
      condominio,
      meta: { is_owner: isOwnerAuditor, is_linked: isLinkedAuditor, role },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

// ---------- PATCH ----------
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const admin = supabaseAdmin();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const user = auth.user;
    const role = await getUserRole(supabase);

    const id = params.id;

    const { data: audRaw, error: audErr } = await (admin.from("auditorias") as any)
      .select(AUD_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
    if (!audRaw) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    const aud = audRaw as AudRow;
    const prevStatus: Status = normalizeStatus(aud.status);

    const isManager = roleGte(role, "interno");

    const isOwnerAuditor =
      !!aud.auditor_id && (aud.auditor_id === user.id || aud.auditor_id === user.email);

    const isLinkedAuditor =
      !aud.auditor_id ? await canAuditorAccessByVinculo(admin, user.id, aud.condominio_id) : false;

    const canEdit = isManager || isOwnerAuditor || isLinkedAuditor;
    if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const body = await req.json().catch(() => ({} as any));
    const nextStatus: Status | null = body?.status ? normalizeStatus(body.status) : null;

    if (prevStatus === "final" && !isManager) {
      return NextResponse.json({ error: "Auditoria finalizada: apenas interno/gestor pode reabrir." }, { status: 403 });
    }
    if (nextStatus === "final" && !isManager) {
      return NextResponse.json({ error: "Apenas interno/gestor pode finalizar." }, { status: 403 });
    }

    const patch: any = {};

    // auditor pode editar leituras/fotos/observações
    if ("agua_leitura" in body) patch.agua_leitura = numOrNull(body.agua_leitura);
    if ("energia_leitura" in body) patch.energia_leitura = numOrNull(body.energia_leitura);
    if ("gas_leitura" in body) patch.gas_leitura = numOrNull(body.gas_leitura);

    if ("observacoes" in body) patch.observacoes = textOrNull(body.observacoes);

    if ("foto_agua_url" in body) patch.foto_agua_url = textOrNull(body.foto_agua_url);
    if ("foto_energia_url" in body) patch.foto_energia_url = textOrNull(body.foto_energia_url);
    if ("foto_gas_url" in body) patch.foto_gas_url = textOrNull(body.foto_gas_url);
    if ("foto_quimicos_url" in body) patch.foto_quimicos_url = textOrNull(body.foto_quimicos_url);
    if ("foto_bombonas_url" in body) patch.foto_bombonas_url = textOrNull(body.foto_bombonas_url);
    if ("foto_conector_bala_url" in body) patch.foto_conector_bala_url = textOrNull(body.foto_conector_bala_url);

    if ("fechamento_obs" in body) patch.fechamento_obs = textOrNull(body.fechamento_obs);

    // comprovante: só interno/gestor
    if ("comprovante_fechamento_url" in body && isManager) {
      patch.comprovante_fechamento_url = textOrNull(body.comprovante_fechamento_url);
    }

    if (nextStatus) patch.status = nextStatus;

    const { data: updated, error: upErr } = await (admin.from("auditorias") as any)
      .update(patch)
      .eq("id", id)
      .select(AUD_SELECT)
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
