import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function roleRank(role: Role | null) {
  const w: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return 0;
  return w[role] ?? 0;
}

function roleGte(role: Role | null, min: Role) {
  return roleRank(role) >= roleRank(min);
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (profErr) return null;
  return (prof?.role ?? null) as Role | null;
}

function normalizeStatus(input: any): Status | null {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (s === "aberta") return "aberta";
  if (s === "em_andamento") return "em_andamento";
  if (s === "em_conferencia") return "em_conferencia";
  if (s === "final") return "final";
  return null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    // auth obrigatório
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    if (authErr || !user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // carrega auditoria (para checar auditor_id)
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id, auditor_id, status, leitura_agua, leitura_energia, leitura_gas, observacoes")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json(
        { error: audErr?.message ?? "Auditoria não encontrada" },
        { status: 404 }
      );
    }

    const role = await getUserRole(supabase);

    // permissão:
    // - auditor só edita a própria auditoria
    // - interno/gestor edita qualquer
    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const canEdit = isOwnerAuditor || roleGte(role, "interno");

    if (!canEdit) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // monta patch permitido
    const patch: any = {};

    if (typeof body?.leitura_agua === "string") patch.leitura_agua = body.leitura_agua;
    if (typeof body?.leitura_energia === "string") patch.leitura_energia = body.leitura_energia;
    if (typeof body?.leitura_gas === "string") patch.leitura_gas = body.leitura_gas;
    if (typeof body?.observacoes === "string") patch.observacoes = body.observacoes;

    // status: só aceita valores válidos
    if (body?.status !== undefined) {
      const st = normalizeStatus(body.status);
      if (!st) {
        return NextResponse.json({ error: "Status inválido" }, { status: 400 });
      }
      patch.status = st;
    }

    if (Object.keys(patch).length === 0) {
      // sempre retorna JSON para evitar erro no front
      return NextResponse.json({ auditoria: aud });
    }

    const { data: updated, error: upErr } = await supabase
      .from("auditorias")
      .update(patch)
      .eq("id", auditoriaId)
      .select("id, auditor_id, status, leitura_agua, leitura_energia, leitura_gas, observacoes")
      .single();

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
