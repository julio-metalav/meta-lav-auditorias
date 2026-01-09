import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getUserAndRole } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await req.json();

    const supabase = supabaseServer();
    const { user, role } = await getUserAndRole();

    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (role !== "auditor") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    // 1) Confere se a auditoria existe e se pertence ao auditor logado
    const { data: aud, error: findErr } = await supabase
      .from("auditorias")
      .select("id,auditor_id")
      .eq("id", id)
      .maybeSingle();

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 400 });
    if (!aud) return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });
    if (aud.auditor_id !== user.id) {
      return NextResponse.json({ error: "Você não tem acesso a essa auditoria." }, { status: 403 });
    }

    // 2) Só aceita os campos permitidos
    const payload: any = {};

    if ("leitura_agua" in body) payload.leitura_agua = body.leitura_agua ?? null;
    if ("leitura_energia" in body) payload.leitura_energia = body.leitura_energia ?? null;
    if ("leitura_gas" in body) payload.leitura_gas = body.leitura_gas ?? null;
    if ("observacoes" in body) payload.observacoes = body.observacoes ?? null;

    // status opcional: auditor pode marcar final
    if ("status" in body) payload.status = body.status ?? null;

    // Se não veio nada pra atualizar
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    // 3) Atualiza e retorna SEM referenciar ano_mes (isso é o seu bug)
    const { data: updated, error: updErr } = await supabase
      .from("auditorias")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({ auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
