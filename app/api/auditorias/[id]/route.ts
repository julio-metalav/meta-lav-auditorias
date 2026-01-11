export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

type AudRow = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes: string | null;
  mes_ref: string | null;
  status: Status | string | null;

  leitura_agua: string | null;
  leitura_energia: string | null;
  leitura_gas: string | null;
  observacoes: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;
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
  if (s === "aberta") return "aberta";
  if (s === "final") return "final";
  // default seguro
  return "aberta";
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

// ---------- GET ----------
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const id = params.id;

    // CAST do builder para evitar GenericStringError no TS quando o select/join diverge do Database gerado
    const { data, error } = await (supabase.from("auditorias") as any)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        ano_mes,
        mes_ref,
        status,
        leitura_agua,
        leitura_energia,
        leitura_gas,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url
      `
      )
      .eq("id", id)
      .maybeSingle();

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

    // 1) Carrega auditoria (CAST para matar GenericStringError)
    const { data: audRaw, error: audErr } = await (supabase.from("auditorias") as any)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        ano_mes,
        mes_ref,
        status,
        leitura_agua,
        leitura_energia,
        leitura_gas,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
    if (!audRaw) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    const aud = audRaw as AudRow;

    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const isManager = roleGte(role, "interno");
    const isGestor = role === "gestor";
    const canEdit = isOwnerAuditor || isManager;

    if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // 2) Body
    const body = await req.json().catch(() => ({} as any));

    const nextStatus: Status | null = body?.status != null ? normalizeStatus(body.status) : null;
    const prevStatus: Status = normalizeStatus(aud.status);

    // 3) Regras de travamento
    // Auditor (não interno/gestor) NÃO pode editar após em_conferencia/final
    const isOnlyAuditor = role === "auditor" && !isManager && !isGestor;
    if (isOnlyAuditor && (prevStatus === "em_conferencia" || prevStatus === "final")) {
      return NextResponse.json({ error: "Auditor não pode editar após em_conferencia/final" }, { status: 403 });
    }

    // Auditor NÃO pode reabrir (voltar status)
    if (isOnlyAuditor && nextStatus && nextStatus !== prevStatus) {
      const allowedForward: Record<Status, Status[]> = {
        aberta: ["em_andamento", "em_conferencia", "final"],
        em_andamento: ["em_conferencia", "final"],
        em_conferencia: ["final"],
        final: [],
      };

      const ok = allowedForward[prevStatus].includes(nextStatus);
      if (!ok) {
        return NextResponse.json({ error: "Auditor não pode reabrir/voltar status" }, { status: 403 });
      }
    }

    // Só gestor pode mexer em auditoria final
    if (!isGestor && prevStatus === "final") {
      return NextResponse.json({ error: "Somente gestor pode editar auditoria final" }, { status: 403 });
    }

    // 4) Monta patch
    const patch: Partial<AudRow> & { status?: Status } = {};

    // campos editáveis
    if (body?.leitura_agua !== undefined) patch.leitura_agua = body.leitura_agua ?? null;
    if (body?.leitura_energia !== undefined) patch.leitura_energia = body.leitura_energia ?? null;
    if (body?.leitura_gas !== undefined) patch.leitura_gas = body.leitura_gas ?? null;
    if (body?.observacoes !== undefined) patch.observacoes = body.observacoes ?? null;

    if (body?.foto_agua_url !== undefined) patch.foto_agua_url = body.foto_agua_url ?? null;
    if (body?.foto_energia_url !== undefined) patch.foto_energia_url = body.foto_energia_url ?? null;
    if (body?.foto_gas_url !== undefined) patch.foto_gas_url = body.foto_gas_url ?? null;

    if (nextStatus) patch.status = nextStatus;

    // nada pra salvar
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, auditoria: aud });
    }

    // 5) Update auditoria
    const { data: updatedRaw, error: updErr } = await (supabase.from("auditorias") as any)
      .update(patch)
      .eq("id", id)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        ano_mes,
        mes_ref,
        status,
        leitura_agua,
        leitura_energia,
        leitura_gas,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url
      `
      )
      .maybeSingle();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    const updated = (updatedRaw ?? null) as AudRow | null;

    // 6) Log de status (se mudou)
    if (nextStatus && normalizeStatus(aud.status) !== nextStatus) {
      const logPayload = {
        auditoria_id: id,
        from_status: prevStatus,
        to_status: nextStatus,
        changed_by: user.id,
      };

      // log não deve quebrar o patch
      await (supabase.from("auditoria_status_logs") as any).insert(logPayload);
    }

    return NextResponse.json({ ok: true, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
