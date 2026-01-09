import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  try {
    const supabase = supabaseServer();

    // garante usuário logado
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const body = await req.json();

    // só aceita campos conhecidos (evita alguém mandar lixo)
    const payload: any = {};
    if (body.leitura_agua !== undefined) payload.leitura_agua = body.leitura_agua;
    if (body.leitura_energia !== undefined) payload.leitura_energia = body.leitura_energia;
    if (body.leitura_gas !== undefined) payload.leitura_gas = body.leitura_gas;
    if (body.observacoes !== undefined) payload.observacoes = body.observacoes;

    // status (opcional) — auditor pode marcar "final" quando concluir em campo
    if (body.status !== undefined) payload.status = body.status;

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    // atualiza, mas respeitando RLS (política que você já montou: auditor só altera a própria auditoria)
    const { data, error } = await supabase
      .from("auditorias")
      .update(payload)
      .eq("id", id)
      .select(
        `
        id, condominio_id, auditor_id, status, ano_mes, mes_ref, created_at,
        leitura_agua, leitura_energia, leitura_gas, observacoes,
        foto_agua_url, foto_energia_url, foto_gas_url, foto_quimicos_url, foto_bombonas_url, foto_conector_bala_url
      `
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ auditoria: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
