export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeMetodo(input: any): "direto" | "boleto" {
  const s = String(input ?? "").trim().toLowerCase();
  if (s.includes("diret")) return "direto";
  if (s.includes("boleto")) return "boleto";
  return "boleto";
}

async function fetchCondominioBasics(condominioId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("condominios")
    .select(
      [
        "id",
        "tipo_pagamento",
        "valor_ciclo_lavadora",
        "valor_ciclo_secadora",
        "cashback_percent",
        "agua_valor_m3",
        "energia_valor_kwh",
        "gas_valor_m3",
      ].join(",")
    )
    .eq("id", condominioId)
    .maybeSingle();

  if (error) return { condominio: null as any, error };
  return { condominio: data, error: null as any };
}

function withCompatAliases(aud: any, condominio: any) {
  const pagamento_metodo = normalizeMetodo(condominio?.tipo_pagamento);

  const base_agua = aud?.agua_leitura_base ?? null;
  const base_energia = aud?.energia_leitura_base ?? null;
  const base_gas = aud?.gas_leitura_base ?? null;

  // ✅ SEMPRE vem do cadastro do condomínio
  const cashback_percent = condominio?.cashback_percent ?? null;

  const agua_valor_m3 = condominio?.agua_valor_m3 ?? null;
  const energia_valor_kwh = condominio?.energia_valor_kwh ?? null;
  const gas_valor_m3 = condominio?.gas_valor_m3 ?? null;

  return {
    ...aud,
    pagamento_metodo,
    base_agua,
    base_energia,
    base_gas,
    cashback_percent,
    agua_valor_m3,
    energia_valor_kwh,
    gas_valor_m3,
  };
}

const AUDITORIA_SELECT = [
  "id",
  "condominio_id",
  "auditor_id",
  "mes_ref",
  "status",
  "agua_leitura",
  "energia_leitura",
  "gas_leitura",
  "agua_leitura_base",
  "energia_leitura_base",
  "gas_leitura_base",
  "leitura_base_origem",
  "observacoes",

  // fechamento
  "comprovante_fechamento_url",
  "fechamento_obs",

  "foto_agua_url",
  "foto_energia_url",
  "foto_gas_url",
  "foto_quimicos_url",
  "foto_bombonas_url",
  "foto_conector_bala_url",
  "created_at",
  "updated_at",
].join(",");

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user)
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();
    const id = params.id;

    const { data: aud, error: audErr } = await sb
      .from("auditorias")
      .select(AUDITORIA_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (audErr)
      return NextResponse.json({ ok: false, error: audErr.message }, { status: 400 });
    if (!aud)
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const audRow: any = aud;

    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = audRow.auditor_id === user.id;
    const isUnassigned = !audRow.auditor_id;

    if (!isManager && !(isOwnerAuditor || isUnassigned)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { condominio, error: condoErr } = await fetchCondominioBasics(
      audRow.condominio_id
    );

    const payload = withCompatAliases(audRow, condoErr ? null : condominio);

    return NextResponse.json({ ok: true, data: payload, auditoria: payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "server_error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user)
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();
    const id = params.id;
    const body = await req.json().catch(() => ({}));

    const { data: aud, error: audErr } = await sb
      .from("auditorias")
      .select("id, condominio_id, auditor_id, status")
      .eq("id", id)
      .maybeSingle();

    if (audErr)
      return NextResponse.json({ ok: false, error: audErr.message }, { status: 400 });
    if (!aud)
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const audRow: any = aud;

    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = audRow.auditor_id === user.id;
    const isUnassigned = !audRow.auditor_id;

    if (!isManager && !(isOwnerAuditor || isUnassigned)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const allowed = [
      "agua_leitura",
      "energia_leitura",
      "gas_leitura",
      "observacoes",
      "fechamento_obs",
      "foto_agua_url",
      "foto_energia_url",
      "foto_gas_url",
      "foto_quimicos_url",
      "foto_bombonas_url",
      "foto_conector_bala_url",
      "status",
    ];

    const patch: any = {};
    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }

    if (typeof patch.status === "string") {
      const s = patch.status.toLowerCase();
      if (!["aberta", "em_andamento", "em_conferencia", "final"].includes(s)) {
        delete patch.status;
      } else {
        patch.status = s;
      }
    }

    if (!isManager && patch.status === "final") delete patch.status;
    if (!isManager && patch.status && patch.status !== "em_conferencia")
      delete patch.status;

    const { data: saved, error: saveErr } = await sb
      .from("auditorias")
      .update(patch)
      .eq("id", id)
      .select(AUDITORIA_SELECT)
      .maybeSingle();

    if (saveErr)
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 400 });

    const { condominio } = await fetchCondominioBasics(saved!.condominio_id);
    const payload = withCompatAliases(saved, condominio);

    return NextResponse.json({ ok: true, data: payload, auditoria: payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "server_error" },
      { status: 500 }
    );
  }
}
