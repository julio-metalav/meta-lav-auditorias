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

  return { condominio: data ?? null, error };
}

function withCompatAliases(aud: any, condominio: any) {
  return {
    ...aud,
    pagamento_metodo: normalizeMetodo(condominio?.tipo_pagamento),
    base_agua: aud?.agua_leitura_base ?? null,
    base_energia: aud?.energia_leitura_base ?? null,
    base_gas: aud?.gas_leitura_base ?? null,
    cashback_percent: condominio?.cashback_percent ?? null,
    agua_valor_m3: condominio?.agua_valor_m3 ?? null,
    energia_valor_kwh: condominio?.energia_valor_kwh ?? null,
    gas_valor_m3: condominio?.gas_valor_m3 ?? null,
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

/* =========================
   GET /api/auditorias/[id]
========================= */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const id = params.id.replace(/"/g, "");

    const { data, error } = await sb
      .from("auditorias")
      .select(AUDITORIA_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const aud = data as any;

    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = aud.auditor_id === user.id;
    const isUnassigned = !aud.auditor_id;

    if (!isManager && !(isOwnerAuditor || isUnassigned)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { condominio } = await fetchCondominioBasics(aud.condominio_id);
    const payload = withCompatAliases(aud, condominio);

    return NextResponse.json({ ok: true, data: payload, auditoria: payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "server_error" },
      { status: 500 }
    );
  }
}

/* =========================
   PATCH /api/auditorias/[id]
========================= */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const id = params.id.replace(/"/g, "");
    const body = await req.json().catch(() => ({}));

    const { data, error } = await sb
      .from("auditorias")
      .select("id, condominio_id, auditor_id, status")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const aud = data as any;

    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = aud.auditor_id === user.id;
    const isUnassigned = !aud.auditor_id;

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
    if (!isManager && patch.status && patch.status !== "em_conferencia") {
      delete patch.status;
    }

    const { data: saved, error: saveErr } = await sb
      .from("auditorias")
      .update(patch)
      .eq("id", id)
      .select(AUDITORIA_SELECT)
      .maybeSingle();

    if (saveErr) {
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 400 });
    }
    if (!saved) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const savedAud = saved as any;

    const { condominio } = await fetchCondominioBasics(savedAud.condominio_id);
    const payload = withCompatAliases(savedAud, condominio);

    return NextResponse.json({ ok: true, data: payload, auditoria: payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "server_error" },
      { status: 500 }
    );
  }
}
