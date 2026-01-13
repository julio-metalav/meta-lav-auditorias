export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

type AudRow = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  mes_ref: string | null;
  status: Status | string | null;

  agua_leitura: number | null;
  energia_leitura: number | null;
  gas_leitura: number | null;

  agua_leitura_base?: number | null;
  energia_leitura_base?: number | null;
  gas_leitura_base?: number | null;
  leitura_base_origem?: string | null;

  observacoes: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;

  foto_quimicos_url?: string | null;
  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  // FECHAMENTO (interno/gestor)
  comprovante_fechamento_url?: string | null;
  fechamento_obs?: string | null;
  fechado_por?: string | null;
  fechado_em?: string | null;
};

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia" || s === "em_conferencia" || s === "em confer├¬ncia") return "em_conferencia";
  if (s === "em andamento" || s === "em_andamento") return "em_andamento";
  if (s === "final" || s === "finalizado") return "final";
  if (s === "aberta" || s === "aberto") return "aberta";
  return "aberta";
}

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

/**
 * Checklist de campo (gás opcional)
 * Obrigatório:
 * - leituras: água e energia
 * - fotos: água, energia, químicos, bombonas, conector
 * Opcional:
 * - gás e foto gás
 */
function buildChecklistMissing(effective: AudRow) {
  const missing: string[] = [];

  if (effective.agua_leitura == null) missing.push("Leitura de água");
  if (effective.energia_leitura == null) missing.push("Leitura de energia");

  if (!effective.foto_agua_url) missing.push("Foto do medidor de água");
  if (!effective.foto_energia_url) missing.push("Foto do medidor de energia");

  if (!effective.foto_quimicos_url) missing.push("Foto da proveta (químicos)");
  if (!effective.foto_bombonas_url) missing.push("Foto das bombonas (detergente + amaciante)");
  if (!effective.foto_conector_bala_url) missing.push("Foto do conector bala conectado");

  // gás opcional
  return missing;
}

const AUD_SELECT =
  "id,condominio_id,auditor_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,agua_leitura_base,energia_leitura_base,gas_leitura_base,leitura_base_origem,observacoes,foto_agua_url,foto_energia_url,foto_gas_url,foto_quimicos_url,foto_bombonas_url,foto_conector_bala_url,comprovante_fechamento_url,fechamento_obs,fechado_por,fechado_em";

const AUD_SELECT_MIN =
  "id,condominio_id,auditor_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,observacoes,foto_agua_url,foto_energia_url,foto_gas_url,foto_quimicos_url,foto_bombonas_url,foto_conector_bala_url,comprovante_fechamento_url,fechamento_obs,fechado_por,fechado_em";

// ---------- GET ----------
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const id = params.id;

    const { data, error } = await (supabase.from("auditorias") as any).select(AUD_SELECT).eq("id", id).maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    return NextResponse.json({ auditoria: data as AudRow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

// ---------- PATCH ----------
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const id = params.id;

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const role = await getUserRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role" }, { status: 403 });

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
    const canEdit = isOwnerAuditor || isManager;

    if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // 2) Body
    const body = await req.json().catch(() => ({} as any));
    const nextStatus: Status | null = body?.status != null ? normalizeStatus(body.status) : null;

    const isOnlyAuditor = role === "auditor" && !isManager && !isGestor;

    // Auditor não edita após em_conferencia/final
    if (isOnlyAuditor && (prevStatus === "em_conferencia" || prevStatus === "final")) {
      return NextResponse.json({ error: "Auditor não pode editar após em_conferencia/final" }, { status: 403 });
    }

    /**
     * REABRIR PARA CORREÇÃO (política A)
     * interno/gestor pode mudar: final -> em_conferencia
     * mas interno NÃO pode editar campos em final (só reabrir).
     */
    const reopeningFinalAsInterno = prevStatus === "final" && !isGestor && nextStatus === "em_conferencia";
    if (prevStatus === "final" && !isGestor) {
      if (!reopeningFinalAsInterno) {
        return NextResponse.json(
          { error: "Somente gestor pode editar auditoria final (interno só pode reabrir)" },
          { status: 403 }
        );
      }

      // reabertura deve alterar só status/note
      const allowedKeys = new Set(["status", "note"]);
      const extraKeys = Object.keys(body ?? {}).filter((k) => !allowedKeys.has(k));
      if (extraKeys.length > 0) {
        return NextResponse.json(
          { error: `Reabertura deve alterar apenas status. Campos extras: ${extraKeys.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Auditor: só pode concluir -> em_conferencia
    if (isOnlyAuditor && nextStatus && nextStatus !== prevStatus) {
      const canConclude = (prevStatus === "aberta" || prevStatus === "em_andamento") && nextStatus === "em_conferencia";
      if (!canConclude) {
        return NextResponse.json(
          { error: "Auditor só pode concluir em campo (status em_conferencia). Não pode reabrir nem finalizar." },
          { status: 403 }
        );
      }
    }

    // Finalizar: interno/gestor somente em_conferencia -> final
    if (nextStatus === "final" && prevStatus !== "final") {
      if (!roleGte(role, "interno")) return NextResponse.json({ error: "Somente interno/gestor pode finalizar auditoria" }, { status: 403 });
      if (prevStatus !== "em_conferencia") {
        return NextResponse.json({ error: "Só é possível finalizar quando a auditoria estiver em_conferencia" }, { status: 400 });
      }

      // REGRA: só finaliza se existir comprovante
      if (!aud.comprovante_fechamento_url) {
        return NextResponse.json(
          { error: "Não é possível finalizar sem comprovante de fechamento anexado (comprovante_fechamento)." },
          { status: 400 }
        );
      }
    }

    // 3) Monta patch
    const patch: Partial<AudRow> & { status?: Status } = {};

    if (reopeningFinalAsInterno) {
      patch.status = "em_conferencia";
      // ao reabrir: limpa metadados de fechamento (comprovante pode ficar anexado)
      patch.fechado_por = null;
      patch.fechado_em = null;
    } else {
      // gestor pode editar final (mantém regra)
      if (!isGestor && prevStatus === "final") {
        return NextResponse.json({ error: "Somente gestor pode editar auditoria final" }, { status: 403 });
      }

      if (body?.agua_leitura !== undefined) patch.agua_leitura = toNumberOrNull(body.agua_leitura);
      if (body?.energia_leitura !== undefined) patch.energia_leitura = toNumberOrNull(body.energia_leitura);
      if (body?.gas_leitura !== undefined) patch.gas_leitura = toNumberOrNull(body.gas_leitura);

      if (body?.observacoes !== undefined) patch.observacoes = body.observacoes ?? null;

      if (body?.foto_agua_url !== undefined) patch.foto_agua_url = body.foto_agua_url ?? null;
      if (body?.foto_energia_url !== undefined) patch.foto_energia_url = body.foto_energia_url ?? null;
      if (body?.foto_gas_url !== undefined) patch.foto_gas_url = body.foto_gas_url ?? null;

      if (body?.foto_quimicos_url !== undefined) patch.foto_quimicos_url = body.foto_quimicos_url ?? null;
      if (body?.foto_bombonas_url !== undefined) patch.foto_bombonas_url = body.foto_bombonas_url ?? null;
      if (body?.foto_conector_bala_url !== undefined) patch.foto_conector_bala_url = body.foto_conector_bala_url ?? null;

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

        const missing = buildChecklistMissing(effective);
        if (missing.length > 0) {
          return NextResponse.json(
            { error: "Checklist incompleto. Não é possível concluir (em_conferencia).", missing },
            { status: 400 }
          );
        }
      }

      // Se está finalizando agora, grava metadados
      if (nextStatus === "final" && prevStatus !== "final") {
        patch.fechado_por = user.id;
        patch.fechado_em = new Date().toISOString();
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, auditoria: aud });
    }

    // 4) Update
    const { data: updatedRaw, error: updErr } = await (supabase.from("auditorias") as any)
      .update(patch)
      .eq("id", id)
      .select(AUD_SELECT_MIN)
      .maybeSingle();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    const updated = (updatedRaw ?? null) as AudRow | null;

    // 5) Log de status (best-effort)
    if (nextStatus && normalizeStatus(aud.status) !== nextStatus) {
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim().slice(0, 500) : null;

      const logPayload = {
        auditoria_id: id,
        from_status: prevStatus,
        to_status: nextStatus,
        actor_id: user.id,
        actor_role: role,
        note,
      };

      try {
        await (supabase.from("auditoria_status_logs") as any).insert(logPayload);
      } catch {
        // não quebra fluxo
      }
    }

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
