export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("auditorias")
    .select(
      "*, condominios(*)"
    )
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (role === "auditor" && data?.auditor_id !== user.id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // carregar auditoria para checar permissões
  const { data: aud, error: audErr } = await supabase
    .from("auditorias")
    .select("id,auditor_id,status")
    .eq("id", params.id)
    .single();

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  if (role === "auditor") {
    if (aud.auditor_id !== user.id) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // auditor só pode preencher dados de campo e anexos, e alterar status até "em_conferencia"
    const allowed: any = {
      agua_leitura: body.agua_leitura ?? undefined,
      energia_leitura: body.energia_leitura ?? undefined,
      gas_leitura: body.gas_leitura ?? undefined,
      quimicos_detergente_ml: body.quimicos_detergente_ml ?? undefined,
      quimicos_amaciante_ml: body.quimicos_amaciante_ml ?? undefined,
      foto_agua_url: body.foto_agua_url ?? undefined,
      foto_energia_url: body.foto_energia_url ?? undefined,
      foto_gas_url: body.foto_gas_url ?? undefined,
      foto_proveta_url: body.foto_proveta_url ?? undefined,
      foto_bombonas_url: body.foto_bombonas_url ?? undefined,
      foto_cabo_bala_url: body.foto_cabo_bala_url ?? undefined,
      status: body.status ?? undefined,
    };

    if (allowed.status && !["aberta", "em_campo", "em_conferencia"].includes(String(allowed.status))) {
      return NextResponse.json({ error: "Status inválido para auditor" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("auditorias")
      .update(allowed)
      .eq("id", params.id)
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, data });
  }

  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // interno/gestor pode atualizar tudo (inclui ciclos, cashback, status final)
  const { data, error } = await supabase
    .from("auditorias")
    .update(body)
    .eq("id", params.id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}
