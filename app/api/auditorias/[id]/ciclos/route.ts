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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    // role
    const role = await getRole(supabase);
    if (!roleGte(role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const auditoriaId = params.id;

    // payload esperado:
    // { itens: [{ condominio_maquina_id?: string|null, ciclos: number, valor_total?: number|null, observacao?: string|null }, ...] }
    const body = await req.json().catch(() => null);
    const itens = Array.isArray(body?.itens) ? body.itens : Array.isArray(body) ? body : [];

    if (!itens.length) {
      return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });
    }

    // limpa itens anteriores desse fechamento (idempotente)
    const { error: delErr } = await (supabase.from("auditoria_fechamento_itens") as any)
      .delete()
      .eq("auditoria_id", auditoriaId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const rowsToInsert = itens.map((it: any) => {
      const ciclos = Number(it?.ciclos ?? 0);
      const condominio_maquina_id = it?.condominio_maquina_id ?? null;

      // fallback: se não tiver máquina, permite valor_total manual (ou 0)
      const valor_total =
        it?.valor_total === null || it?.valor_total === undefined ? null : Number(it.valor_total);

      return {
        auditoria_id: auditoriaId,
        condominio_maquina_id,
        ciclos: Number.isFinite(ciclos) ? ciclos : 0,
        valor_total: Number.isFinite(valor_total as any) ? valor_total : null,
        observacao: it?.observacao ?? null,
      };
    });

    const { error: insErr } = await (supabase.from("auditoria_fechamento_itens") as any).insert(rowsToInsert);

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
