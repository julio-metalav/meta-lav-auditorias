export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

type TipoPagamento = "direto" | "boleto";

function normalizeTipoPagamento(input: any): TipoPagamento {
  const s = String(input ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (role === "auditor") {
    const { data, error } = await supabase
      .from("auditor_condominios")
      .select(
        "condominio_id, condominios(id,nome,cidade,uf,cep,rua,numero,bairro,complemento,tipo_pagamento,cashback_percent,agua_valor_m3,energia_valor_kwh,gas_valor_m3)"
      )
      .eq("auditor_id", user.id)
      .order("condominios(nome)");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const condos = (data ?? []).map((r: any) => r.condominios).filter(Boolean);
    return NextResponse.json({ data: condos });
  }

  const { data, error } = await supabase
    .from("condominios")
    .select(
      "id,nome,cidade,uf,cep,rua,numero,bairro,complemento,tipo_pagamento,cashback_percent,agua_valor_m3,energia_valor_kwh,gas_valor_m3,created_at"
    )
    .order("nome", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const payload = {
    nome: String(body?.nome || "").trim(),
    cidade: String(body?.cidade || "").trim(),
    uf: String(body?.uf || "").trim(),
    cep: String(body?.cep || "").trim(),
    rua: String(body?.rua || "").trim(),
    numero: String(body?.numero || "").trim(),
    bairro: String(body?.bairro || "").trim(),
    complemento: String(body?.complemento || "").trim(),
    sindico_nome: String(body?.sindico_nome || "").trim(),
    sindico_telefone: String(body?.sindico_telefone || "").trim(),
    zelador_nome: String(body?.zelador_nome || "").trim(),
    zelador_telefone: String(body?.zelador_telefone || "").trim(),
    valor_ciclo_lavadora: body?.valor_ciclo_lavadora ?? null,
    valor_ciclo_secadora: body?.valor_ciclo_secadora ?? null,
    cashback_percent: body?.cashback_percent ?? null,
    banco: String(body?.banco || "").trim(),
    favorecido_cnpj: String(body?.favorecido_cnpj || "").trim(),
    agencia: String(body?.agencia || "").trim(),
    conta: String(body?.conta || "").trim(),
    tipo_conta: String(body?.tipo_conta || "").trim(),
    pix: String(body?.pix || "").trim(),
    maquinas: body?.maquinas ?? null,

    // ✅ NOVO: tarifas (repasse por consumo)
    agua_valor_m3: numOrNull(body?.agua_valor_m3),
    energia_valor_kwh: numOrNull(body?.energia_valor_kwh),
    gas_valor_m3: numOrNull(body?.gas_valor_m3),

    // NOVO (regra de negócio): default direto
    tipo_pagamento: normalizeTipoPagamento(body?.tipo_pagamento),
  };

  if (!payload.nome || !payload.cidade || !payload.uf) {
    return NextResponse.json({ error: "Campos obrigatórios: nome, cidade, uf" }, { status: 400 });
  }

  const { data, error } = await supabase.from("condominios").insert(payload).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}
