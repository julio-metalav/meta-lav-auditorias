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
  // fallback seguro
  return "boleto";
}

async function canAuditorAccessByVinculo(auditorId: string, condominioId: string) {
  // FIX IMPORTANTE: vínculo é via auditor_condominios (não via auditoria)
  const { data, error } = await supabaseAdmin
    .from("auditor_condominios")
    .select("id")
    .eq("auditor_id", auditorId)
    .eq("condominio_id", condominioId)
    .maybeSingle();

  if (error) return false;
  return !!data?.id;
}

async function fetchCondominioBasics(condominioId: string) {
  const { data, error } = await supabaseAdmin
    .from("condominios")
    .select("id, tipo_pagamento, valor_ciclo_lavadora, valor_ciclo_secadora")
    .eq("id", condominioId)
    .maybeSingle();

  if (error) return { condominio: null as any, error };
  return { condominio: data, error: null as any };
}

function withCompatAliases(aud: any, condominio: any) {
  const pagamento_metodo = normalizeMetodo(condominio?.tipo_pagamento);

  // Compat com telas antigas que esperam base_agua/base_energia/base_gas
  const base_agua = aud?.agua_leitura_base ?? null;
  const base_energia = aud?.energia_leitura_base ?? null;
  const base_gas = aud?.gas_leitura_base ?? null;

  return {
    ...aud,
    pagamento_metodo,
    base_agua,
    base_energia,
    base_gas,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const id = params.id;

    // 🔥 CORREÇÃO DO BUG: NÃO selecionar auditorias.base_agua (coluna não existe)
    // Usar agua_leitura_base / energia_leitura_base / gas_leitura_base
    const { data: aud, error: audErr } = await supabaseAdmin
      .from("auditorias")
      .select(
        [
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
          "foto_agua_url",
          "foto_energia_url",
          "foto_gas_url",
          "foto_quimicos_url",
          "foto_bombonas_url",
          "foto_conector_bala_url",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .eq("id", id)
      .maybeSingle();

    if (audErr) {
      return NextResponse.json({ ok: false, error: audErr.message }, { status: 400 });
    }
    if (!aud) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    // Permissões
    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const isVinculado = await canAuditorAccessByVinculo(user.id, aud.condominio_id);

    if (!isManager && !isOwnerAuditor && !isVinculado) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { condominio, error: condoErr } = await fetchCondominioBasics(aud.condominio_id);
    if (condoErr) {
      // mesmo com erro do condominio, devolve auditoria (não quebrar UI)
      const payload = withCompatAliases(aud, null);
      return NextResponse.json({ ok: true, data: payload, auditoria: payload }, { status: 200 });
    }

    const payload = withCompatAliases(aud, condominio);
    return NextResponse.json({ ok: true, data: payload, auditoria: payload }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const id = params.id;
    const body = await req.json().catch(() => ({}));

    // Carrega auditoria para permissão + condominio_id
    const { data: aud, error: audErr } = await supabaseAdmin
      .from("auditorias")
      .select("id, condominio_id, auditor_id, status")
      .eq("id", id)
      .maybeSingle();

    if (audErr) return NextResponse.json({ ok: false, error: audErr.message }, { status: 400 });
    if (!aud) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const isManager = roleGte(role, "interno");
    const isOwnerAuditor = !!aud.auditor_id && aud.auditor_id === user.id;
    const isVinculado = await canAuditorAccessByVinculo(user.id, aud.condominio_id);

    if (!isManager && !isOwnerAuditor && !isVinculado) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Auditor pode salvar campo (leituras/fotos/obs) e concluir em_conferencia.
    // Interno/Gestor podem tudo (sem ampliar escopo aqui).
    const patch: any = {};

    const allowed = [
      "agua_leitura",
      "energia_leitura",
      "gas_leitura",
      "observacoes",
      "foto_agua_url",
      "foto_energia_url",
      "foto_gas_url",
      "foto_quimicos_url",
      "foto_bombonas_url",
      "foto_conector_bala_url",
      "status",
    ];

    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }

    // Normalize status
    if (typeof patch.status === "string") {
      const s = String(patch.status).trim().toLowerCase();
      const okStatus: Status[] = ["aberta", "em_andamento", "em_conferencia", "final"];
      if (!okStatus.includes(s as Status)) delete patch.status;
      else patch.status = s;
    }

    // Auditor não finaliza direto (regra do mapa): finaliza é Interno/Gestor
    if (!isManager && patch.status === "final") {
      delete patch.status;
    }

    // Se auditor concluiu campo, status deve virar em_conferencia
    // (mantém seu fluxo)
    if (!isManager && patch.status && patch.status !== "em_conferencia") {
      // auditor só pode mandar em_conferencia (ou não mandar status)
      delete patch.status;
    }

    const { data: saved, error: saveErr } = await supabaseAdmin
      .from("auditorias")
      .update(patch)
      .eq("id", id)
      .select(
        [
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
          "foto_agua_url",
          "foto_energia_url",
          "foto_gas_url",
          "foto_quimicos_url",
          "foto_bombonas_url",
          "foto_conector_bala_url",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .maybeSingle();

    if (saveErr) {
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 400 });
    }

    const { condominio } = await fetchCondominioBasics(saved!.condominio_id);
    const payload = withCompatAliases(saved, condominio);

    return NextResponse.json({ ok: true, data: payload, auditoria: payload }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}
