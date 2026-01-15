export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

type TipoPagamento = "direto" | "boleto";

function normalizeTipoPagamento(input: any): TipoPagamento {
  const s = String(input ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

function str(v: any) {
  return String(v ?? "").trim();
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const id = String(params?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  // Auditor só pode ver condomínio atribuído a ele
  if (role === "auditor") {
    const { data: vinc, error: vincErr } = await supabase
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", user.id)
      .eq("condominio_id", id)
      .maybeSingle();

    if (vincErr) return NextResponse.json({ error: vincErr.message }, { status: 400 });
    if (!vinc) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("condominios")
    .select(
      "id,nome,cidade,uf,cep,rua,numero,bairro,complemento," +
        "sindico_nome,sindico_telefone,zelador_nome,zelador_telefone," +
        "valor_ciclo_lavadora,valor_ciclo_secadora,cashback_percent," +
        "banco,favorecido_cnpj,agencia,conta,tipo_conta,pix,maquinas," +
        "tipo_pagamento,created_at"
    )
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const id = String(params?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const patch: any = {};

  // PATCH: só atualiza o que vier
  if (body?.nome !== undefined) patch.nome = str(body?.nome);
  if (body?.cidade !== undefined) patch.cidade = str(body?.cidade);
  if (body?.uf !== undefined) patch.uf = str(body?.uf);
  if (body?.cep !== undefined) patch.cep = str(body?.cep);
  if (body?.rua !== undefined) patch.rua = str(body?.rua);
  if (body?.numero !== undefined) patch.numero = str(body?.numero);
  if (body?.bairro !== undefined) patch.bairro = str(body?.bairro);
  if (body?.complemento !== undefined) patch.complemento = str(body?.complemento);

  if (body?.sindico_nome !== undefined) patch.sindico_nome = str(body?.sindico_nome);
  if (body?.sindico_telefone !== undefined) patch.sindico_telefone = str(body?.sindico_telefone);
  if (body?.zelador_nome !== undefined) patch.zelador_nome = str(body?.zelador_nome);
  if (body?.zelador_telefone !== undefined) patch.zelador_telefone = str(body?.zelador_telefone);

  if (body?.valor_ciclo_lavadora !== undefined) patch.valor_ciclo_lavadora = body?.valor_ciclo_lavadora ?? null;
  if (body?.valor_ciclo_secadora !== undefined) patch.valor_ciclo_secadora = body?.valor_ciclo_secadora ?? null;
  if (body?.cashback_percent !== undefined) patch.cashback_percent = body?.cashback_percent ?? null;

  if (body?.banco !== undefined) patch.banco = str(body?.banco);
  if (body?.favorecido_cnpj !== undefined) patch.favorecido_cnpj = str(body?.favorecido_cnpj);
  if (body?.agencia !== undefined) patch.agencia = str(body?.agencia);
  if (body?.conta !== undefined) patch.conta = str(body?.conta);
  if (body?.tipo_conta !== undefined) patch.tipo_conta = str(body?.tipo_conta);
  if (body?.pix !== undefined) patch.pix = str(body?.pix);

  if (body?.maquinas !== undefined) patch.maquinas = body?.maquinas ?? null;

  // NOVO: tipo_pagamento
  if (body?.tipo_pagamento !== undefined) {
    patch.tipo_pagamento = normalizeTipoPagamento(body?.tipo_pagamento);
  }

  // valida obrigatórios se vierem no patch
  if (patch.nome !== undefined && !patch.nome) {
    return NextResponse.json({ error: "nome não pode ficar vazio" }, { status: 400 });
  }
  if (patch.cidade !== undefined && !patch.cidade) {
    return NextResponse.json({ error: "cidade não pode ficar vazio" }, { status: 400 });
  }
  if (patch.uf !== undefined && !patch.uf) {
    return NextResponse.json({ error: "uf não pode ficar vazio" }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("condominios")
    .update(patch)
    .eq("id", id)
    .select("id,tipo_pagamento")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, data });
}
