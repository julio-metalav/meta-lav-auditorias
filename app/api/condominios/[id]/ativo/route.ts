export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const condominioId = params.id;
  if (!condominioId) {
    return NextResponse.json({ error: "ID do condomínio ausente" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const ativo = body?.ativo;

  if (typeof ativo !== "boolean") {
    return NextResponse.json(
      { error: "Campo 'ativo' deve ser boolean" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("condominios")
    .update({ ativo })
    .eq("id", condominioId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ativo });
}
