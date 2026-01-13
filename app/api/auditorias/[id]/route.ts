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
  status: string | null;

  agua_leitura: number | null;
  energia_leitura: number | null;
  gas_leitura: number | null;
  observacoes: string | null;

  foto_agua_url: string | null;
  foto_energia_url: string | null;
  foto_gas_url: string | null;
  foto_quimicos_url: string | null;
  foto_bombonas_url: string | null;
  foto_conector_bala_url: string | null;
};

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return (s as Status) || "aberta";
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

    const { data, error } = await (supabase.from("auditorias") as any)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        mes_ref,
        status,
        agua_leitura,
        energia_leitura,
        gas_leitura,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url,
        foto_quimicos_url,
        foto_bombonas_url,
        foto_conector_bala_url
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

    // 1) Carrega auditoria
    const { data: audRaw, error: audErr } = await (supabase.from("auditorias") as any)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        mes_ref,
        status,
        agua_leitura,
        energia_leitura,
        gas_leitura,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url,
        foto_quimicos_url,
        foto_bombonas_url,
        foto_conector_bala_url
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
    if (!audRaw) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

    const aud = audRaw as AudRow;

    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;

    // ✅ Opção A: auditoria pode nascer sem auditor_id.
    // Auditor pode editar se estiver vinculado ao condomínio em auditor_condominios.
    let isAssignedAuditor = false;
    if (role === "auditor") {
      const { data: link, error: linkErr } = await (supabase.from("auditor_condominios") as any)
        .select("auditor_id")
        .eq("auditor_id", user.id)
        .eq("condominio_id", aud.condominio_id)
        .maybeSingle();
      if (!linkErr && link) isAssignedAuditor = true;
    }

    const isManager = roleGte(role, "interno"); // interno ou gestor
    const isGestor = role === "gestor";
    const canEdit = isOwnerAuditor || isAssignedAuditor || isManager;

    if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // 2) Body
    const body = await req.json().catch(() => ({} as any));

    const nextStatus: Status | null = body?.status != null ? normalizeStatus(body.status) : null;
    const prevStatus: Status = normalizeStatus(aud.status);

    // 3) Regras oficiais
    const isOnlyAuditor = role === "auditor" && !isManager && !isGestor;

    // Auditor NÃO pode editar após em_conferencia/final
    if (isOnlyAuditor && (prevStatus === "em_conferencia" || prevStatus === "final")) {
      return NextResponse.json({ error: "Auditor não pode editar após Em conferência/Final" }, { status: 403 });
    }

    // Auditor pode marcar em_conferencia quando concluir em campo
    if (isOnlyAuditor && nextStatus && nextStatus !== prevStatus) {
      if (!(prevStatus === "aberta" && nextStatus === "em_conferencia")) {
        return NextResponse.json({ error: "Transição de status não permitida para auditor" }, { status: 403 });
      }
    }

    // 4) Update payload (aceita só campos conhecidos)
    const patch: any = {};
    if (body?.agua_leitura !== undefined) patch.agua_leitura = body.agua_leitura;
    if (body?.energia_leitura !== undefined) patch.energia_leitura = body.energia_leitura;
    if (body?.gas_leitura !== undefined) patch.gas_leitura = body.gas_leitura;
    if (body?.observacoes !== undefined) patch.observacoes = body.observacoes;
    if (nextStatus) patch.status = nextStatus;

    const { data: saved, error: upErr } = await (supabase.from("auditorias") as any)
      .update(patch)
      .eq("id", id)
      .select(
        `
        id,
        condominio_id,
        auditor_id,
        mes_ref,
        status,
        agua_leitura,
        energia_leitura,
        gas_leitura,
        observacoes,
        foto_agua_url,
        foto_energia_url,
        foto_gas_url,
        foto_quimicos_url,
        foto_bombonas_url,
        foto_conector_bala_url
      `
      )
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    return NextResponse.json({ auditoria: saved as AudRow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
