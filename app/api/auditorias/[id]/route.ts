export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole } from "@/lib/auth";

type PatchBody = {
  leitura_agua?: string | null;
  leitura_energia?: string | null;
  leitura_gas?: string | null;
  observacoes?: string | null;
};

export async function PATCH(
  req: Request,
  ctx: { params: { id: string } }
) {
  const auth = await getUserAndRole();
  if (!auth) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { supabase, user, role } = auth;
  const id = ctx.params.id;

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    // body vazio ok
  }

  // Auditor só pode salvar a auditoria dele
  if (role === "auditor") {
    const { data: arow, error: aerr } = await supabase
      .from("auditorias")
      .select("id,auditor_id")
      .eq("id", id)
      .maybeSingle();

    if (aerr) {
      return NextResponse.json({ error: aerr.message }, { status: 500 });
    }
    if (!arow) {
      return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });
    }
    if (arow.auditor_id !== user.id) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  // interno/gestor podem salvar em qualquer auditoria
  if (role !== "auditor" && role !== "interno" && role !== "gestor") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const updatePayload = {
    leitura_agua: body.leitura_agua ?? null,
    leitura_energia: body.leitura_energia ?? null,
    leitura_gas: body.leitura_gas ?? null,
    observacoes: body.observacoes ?? null,
  };

  const { data, error } = await supabase
    .from("auditorias")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, auditoria: data });
}
