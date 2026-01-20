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

function onlyDigits(v: any) {
  return String(v ?? "").replace(/[^\d]/g, "");
}

function codigoOrNull(v: any): string | null {
  const s = onlyDigits(v).slice(0, 4);
  if (!s) return null;
  if (!/^\d{4}$/.test(s)) return null;
  return s;
}

function intOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s; // YYYY-MM-DD
}

function calcVencimento(assinadoEm: string | null, prazoMeses: number | null): string | null {
  if (!assinadoEm || !prazoMeses) return null;
  const d = new Date(assinadoEm + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + prazoMeses);
  return d.toISOString().slice(0, 10);
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
      "id,codigo_condominio,nome,cidade,uf,cep,rua,numero,bairro,complemento," +
        "sindico_nome,sindico_telefone,zelador_nome,zelador_telefone," +
        "valor_ciclo_lavadora,valor_ciclo_secadora,cashback_percent," +
        "banco,favorecido_cnpj,agencia,conta,tipo_conta,pix,maquinas," +
        "agua_valor_m3,energia_valor_kwh,gas_valor_m3," +
        "contrato_assinado_em,contrato_prazo_meses,contrato_vencimento_em,email_sindico,email_financeiro," +
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

  // ✅ NOVO: codigo_condominio (opcional; valida 4 dígitos)
  if (body?.codigo_condominio !== undefined) {
    const c = String(body?.codigo_condominio ?? "").trim();
    if (c === "") {
      patch.codigo_condominio = null; // permite limpar enquanto não está NOT NULL
    } else {
      const parsed = codigoOrNull(c);
      if (!parsed) return NextResponse.json({ error: "codigo_condominio inválido. Use 4 dígitos (ex: 0001)." }, { status: 400 });
      patch.codigo_condominio = parsed;
    }
  }

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

  // tarifas
  if (body?.agua_valor_m3 !== undefined) patch.agua_valor_m3 = numOrNull(body?.agua_valor_m3);
  if (body?.energia_valor_kwh !== undefined) patch.energia_valor_kwh = numOrNull(body?.energia_valor_kwh);
  if (body?.gas_valor_m3 !== undefined) patch.gas_valor_m3 = numOrNull(body?.gas_valor_m3);

  // emails
  if (body?.email_sindico !== undefined) patch.email_sindico = str(body?.email_sindico);
  if (body?.email_financeiro !== undefined) patch.email_financeiro = str(body?.email_financeiro);

  // contrato
  const mexeuAssinatura = body?.contrato_assinado_em !== undefined;
  const mexeuPrazo = body?.contrato_prazo_meses !== undefined;
  const mandouVenc = body?.contrato_vencimento_em !== undefined;

  if (mexeuAssinatura) patch.contrato_assinado_em = dateOrNull(body?.contrato_assinado_em);
  if (mexeuPrazo) patch.contrato_prazo_meses = intOrNull(body?.contrato_prazo_meses);
  if (mandouVenc) patch.contrato_vencimento_em = dateOrNull(body?.contrato_vencimento_em);

  if (!mandouVenc && (mexeuAssinatura || mexeuPrazo)) {
    const ass = (patch.contrato_assinado_em ?? null) as string | null;
    const pr = (patch.contrato_prazo_meses ?? null) as number | null;
    patch.contrato_vencimento_em = calcVencimento(ass, pr);
  }

  // tipo_pagamento
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
    .select(
      "id,codigo_condominio,tipo_pagamento,contrato_assinado_em,contrato_prazo_meses,contrato_vencimento_em,email_sindico,email_financeiro,agua_valor_m3,energia_valor_kwh,gas_valor_m3"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, data });
}
