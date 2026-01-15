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

  base_agua?: number | null;
  base_energia?: number | null;
  base_gas?: number | null;

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

  // vamos injetar (derivado do condomínio) para a UI do Interno funcionar
  pagamento_metodo?: "direto" | "boleto" | null;

  // e também podemos mandar o condomínio aninhado (compat)
  condominios?: { id?: string; nome?: string; cidade?: string; uf?: string; tipo_pagamento?: string | null } | null;
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

const AUD_SELECT = `
  id,
  condominio_id,
  auditor_id,
  mes_ref,
  status,

  agua_leitura,
  energia_leitura,
  gas_leitura,

  base_agua,
  base_energia,
  base_gas,

  observacoes,

  foto_agua_url,
  foto_energia_url,
  foto_gas_url,
  foto_quimicos_url,
  foto_bombonas_url,
  foto_conector_bala_url,

  comprovante_fechamento_url,
  fechamento_obs,
  fechado_por,
  fechado_em,

  condominios (
    id,
    nome,
    cidade,
    uf,
    tipo_pagamento
  )
`;

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
    .select("auditor_id, condominio_id")
    .eq("auditor_id", auditorUserId)
    .eq("condominio_id", condominioId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function derivePagamentoMetodo(tipo_pagamento: any): "direto" | "boleto" | null {
  const t = String(tipo_pagamento ?? "").trim().toLowerCase();
  if (t === "boleto") return "boleto";
  if (t === "direto") return "direto";
  return null;
}

// ---------- GET ----------
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const admin = supabaseAdmin();

    const id = String(params?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

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

    const isLinkedAuditor = !aud.auditor_id
      ? await canAuditorAccessByVinculo(admin, user.id, aud.condominio_id)
      : false;

    if (!isManager && !isOwnerAuditor && !isLinkedAuditor) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // compat: condominio também solto (best-effort)
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

    // ✅ injeta pagamento_metodo dentro da auditoria, que é o que o Interno usa
    const tipo_pagamento = aud?.condominios?.tipo_pagamento ?? condominio?.tipo_pagamento ?? null;
    const mergedAud: AudRow = {
      ...aud,
      pagamento_metodo: derivePagamentoMetodo(tipo_pagamento),
    };

    // ✅ resposta compatível com todas as telas que você já tem
    return NextResponse.json({
      ok: true,
      data: mergedAud,
      auditoria: mergedAud,
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

    const id = String(params?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

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

    const isLinkedAuditor = !aud.auditor_id
      ? await canAuditorAccessByVinculo(admin, user.id, aud.condominio_id)
      : false;

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

    if ("base_agua" in body && isManager) patch.base_agua = numOrNull(body.base_agua);
    if ("base_energia" in body && isManager) patch.base_energia = numOrNull(body.base_energia);
    if ("base_gas" in body && isManager) patch.base_gas = numOrNull(body.base_gas);

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

    const updatedAud = (updated ?? null) as AudRow | null;
    if (!updatedAud) return NextResponse.json({ error: "Falha ao atualizar auditoria" }, { status: 500 });

    // injeta pagamento_metodo para UI do Interno
    const tipo_pagamento = updatedAud?.condominios?.tipo_pagamento ?? null;
    const mergedAud: AudRow = { ...updatedAud, pagamento_metodo: derivePagamentoMetodo(tipo_pagamento) };

    return NextResponse.json({ ok: true, data: mergedAud, auditoria: mergedAud });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
