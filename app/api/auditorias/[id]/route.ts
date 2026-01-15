export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

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

type AudRow = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  mes_ref: string | null;
  status: Status | string;

  // schema novo
  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  // bases
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

const AUD_SELECT =
  "id,condominio_id,auditor_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,agua_leitura_base,energia_leitura_base,gas_leitura_base,leitura_base_origem,observacoes,foto_agua_url,foto_energia_url,foto_gas_url,foto_quimicos_url,foto_bombonas_url,foto_conector_bala_url,comprovante_fechamento_url,fechamento_obs,fechado_por,fechado_em";

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getUserRole(supabase);

    const { data: aud, error } = await (supabase.from("auditorias") as any)
      .select(AUD_SELECT)
      .eq("id", params.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!aud) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    // auditor só pode ver a própria
    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const isManager = roleGte(role, "interno");
    if (!isManager && !isOwnerAuditor) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    return NextResponse.json({ ok: true, auditoria: aud });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const user = auth.user;
    const role = await getUserRole(supabase);

    const id = params.id;

    // 1) Carrega auditoria
    const { data: audRaw, error: audErr } = await (supabase.from("auditorias") as any)
      .select(AUD_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
    if (!audRaw) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    const aud = audRaw as AudRow;
    const prevStatus: Status = normalizeStatus(aud.status);

    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const isManager = roleGte(role, "interno"); // interno/gestor
    const isGestor = role === "gestor";

    // Permissões de edição (resumo):
    // - auditor: só edita a própria auditoria e não edita "final" (só reabrir via interno/gestor)
    // - interno/gestor: pode editar
    const canEdit = isManager || isOwnerAuditor;
    if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // 1.1) carrega tipo de pagamento do condomínio (default "direto")
    // Preferir condominios.tipo_pagamento (ENUM novo). Fallback: pagamento_metodo (legado).
    let tipoPagamento: string = "direto";
    try {
      const { data: c } = await (supabase.from("condominios") as any)
        .select("tipo_pagamento,pagamento_metodo")
        .eq("id", aud.condominio_id)
        .maybeSingle();

      const tp = String((c as any)?.tipo_pagamento ?? "").trim().toLowerCase();
      const pm = String((c as any)?.pagamento_metodo ?? "").trim().toLowerCase();

      tipoPagamento = (tp || pm || "direto").trim().toLowerCase() || "direto";
    } catch {
      tipoPagamento = "direto";
    }

    const exigeComprovante = tipoPagamento === "direto";

    // 2) Body
    const body = await req.json().catch(() => ({} as any));

    // 3) Normaliza status alvo
    const nextStatus: Status | null = body?.status ? normalizeStatus(body.status) : null;

    // 4) Auditor não pode mexer em final (só reabrir por interno/gestor)
    if (prevStatus === "final" && !isManager) {
      return NextResponse.json({ error: "Auditoria finalizada: apenas interno/gestor pode reabrir." }, { status: 403 });
    }

    // 5) Auditor não finaliza
    if (nextStatus === "final" && !isManager) {
      return NextResponse.json({ error: "Apenas interno/gestor pode finalizar." }, { status: 403 });
    }

    // 6) Patch campos permitidos
    const patch: any = {};

    // leituras/observações/fotos (auditor e interno/gestor)
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

    // comprovante_fechamento_url: somente interno/gestor deve anexar via /fotos kind=comprovante_fechamento,
    // mas aqui permitimos manter se já existir
    if ("comprovante_fechamento_url" in body && isManager) {
      patch.comprovante_fechamento_url = textOrNull(body.comprovante_fechamento_url);
    }

    // status
    if (nextStatus) patch.status = nextStatus;

    // Se vai para em_conferencia, checklist deve estar completo
    if (nextStatus === "em_conferencia" && prevStatus !== "em_conferencia") {
      const effective: AudRow = {
        ...aud,
        ...patch,
        foto_agua_url: (patch.foto_agua_url ?? aud.foto_agua_url ?? null) as any,
        foto_energia_url: (patch.foto_energia_url ?? aud.foto_energia_url ?? null) as any,
        foto_gas_url: (patch.foto_gas_url ?? aud.foto_gas_url ?? null) as any,
        foto_quimicos_url: (patch.foto_quimicos_url ?? aud.foto_quimicos_url ?? null) as any,
        foto_bombonas_url: (patch.foto_bombonas_url ?? aud.foto_bombonas_url ?? null) as any,
        foto_conector_bala_url: (patch.foto_conector_bala_url ?? aud.foto_conector_bala_url ?? null) as any,
      };

      // aqui você já tinha sua validação de checklist (mantive como está no seu arquivo original)
      // se quiser, depois a gente deixa essa validação mais “vida real”, mas não mexo agora.
      const missing: string[] = [];
      if (!effective.foto_agua_url) missing.push("foto_agua_url");
      if (!effective.foto_energia_url) missing.push("foto_energia_url");
      // gas pode ser opcional conforme condomínio, mas não tenho aqui o flag - mantive o comportamento atual
      if (!effective.foto_quimicos_url) missing.push("foto_quimicos_url");
      if (!effective.foto_bombonas_url) missing.push("foto_bombonas_url");
      if (!effective.foto_conector_bala_url) missing.push("foto_conector_bala_url");

      if (missing.length) {
        return NextResponse.json(
          { error: `Checklist incompleto para concluir em campo: ${missing.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Se vai FINAL, regra do comprovante depende do tipo_pagamento (direto/boleto)
    if (nextStatus === "final" && prevStatus !== "final") {
      // REGRA: só exige comprovante quando pagamento é direto
      if (exigeComprovante && !aud.comprovante_fechamento_url && !patch.comprovante_fechamento_url) {
        return NextResponse.json(
          { error: "Não é possível finalizar sem comprovante (este condomínio está como pagamento direto)." },
          { status: 400 }
        );
      }

      patch.fechado_por = user.id;
      patch.fechado_em = new Date().toISOString();
    }

    // ao reabrir: limpa metadados de fechamento (comprovante pode ficar anexado)
    if (nextStatus && prevStatus === "final" && nextStatus !== "final") {
      patch.fechado_por = null;
      patch.fechado_em = null;
      // não apago comprovante por padrão (mantém histórico)
    }

    const { data: updated, error: upErr } = await (supabase.from("auditorias") as any)
      .update(patch)
      .eq("id", id)
      .select(AUD_SELECT)
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      auditoria: updated,
      pagamento_metodo: tipoPagamento,
      tipo_pagamento: tipoPagamento,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
