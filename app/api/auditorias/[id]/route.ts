import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await req.json();

    const supabase = supabaseServer();

    // 1) usuário logado
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user;

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // 2) Confere se a auditoria existe e se pertence ao auditor logado
    const { data: aud, error: findErr } = await supabase
      .from("auditorias")
      .select("id,auditor_id")
      .eq("id", id)
      .maybeSingle();

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 400 });
    if (!aud) return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });

    // ✅ permissão REAL: só o auditor dono pode salvar
    if (aud.auditor_id !== user.id) {
      return NextResponse.json({ error: "Sem permissão (auditoria não é sua)." }, { status: 403 });
    }

    // 3) Campos permitidos
    const payload: any = {};

    if ("leitura_agua" in body) payload.leitura_agua = body.leitura_agua ?? null;
    if ("leitura_energia" in body) payload.leitura_energia = body.leitura_energia ?? null;
    if ("leitura_gas" in body) payload.leitura_gas = body.leitura_gas ?? null;
    if ("observacoes" in body) payload.observacoes = body.observacoes ?? null;

    // status opcional (auditor pode concluir em campo)
    if ("status" in body) payload.status = body.status ?? null;

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    // 4) Atualiza e retorna (sem ano_mes)
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
