export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function PATCH(
  _req: Request,
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
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  // 1) busca estado atual
  const { data: atual, error: errAtual } = await supabase
    .from("condominios")
    .select("ativo")
    .eq("id", condominioId)
    .single();

  if (errAtual || !atual) {
    return NextResponse.json(
      { error: "Condomínio não encontrado" },
      { status: 404 }
    );
  }

  const novoStatus = !atual.ativo;

  // 2) atualiza
  const { error: errUpdate } = await supabase
    .from("condominios")
    .update({ ativo: novoStatus })
    .eq("id", condominioId);

  if (errUpdate) {
    return NextResponse.json(
      { error: errUpdate.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    ativo: novoStatus,
  });
}
