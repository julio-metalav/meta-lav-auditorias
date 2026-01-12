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

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia" || s === "em_conferência") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  if (s === "aberta" || s === "em_andamento" || s === "em_conferencia" || s === "final") return s as Status;
  return "aberta";
}

type Schema = {
  table: string;
  condoCol: string; // condominio_id
  monthCol: string; // mes_ref OU ano_mes
  auditorCol: string; // auditor_id OU user_id
  statusCol: string; // status
};

async function detectSchema(admin: ReturnType<typeof supabaseAdmin>): Promise<Schema> {
  // tentativa em ordem: tabela/colunas que já apareceram no projeto
  const candidates: Schema[] = [
    { table: "auditorias", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditorias_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditorias_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
  ];

  // valida testando um select mínimo; sem information_schema
  for (const c of candidates) {
    const { error } = await admin.from(c.table).select(`${c.condoCol}`).limit(1);
    if (!error) return c;
  }

  throw new Error(
    "Não encontrei uma tabela válida de auditorias. Esperava: auditorias/auditoria_mes/auditorias_mes com colunas condominio_id, (mes_ref ou ano_mes), (auditor_id/user_id), status."
  );
}

function pickMonthISO(r: any, sch: Schema) {
  const raw = r?.[sch.monthCol];
  return raw ? String(raw) : null;
}

function normalizeRow(r: any, sch: Schema, condoMap: Map<string, any>, profMap: Map<string, any>) {
  const condominio_id = r[sch.condoCol];
  const auditor_id = r[sch.auditorCol];
  const month = pickMonthISO(r, sch);

  const out: any = { ...r };

  out.condominio_id = condominio_id;
  out.auditor_id = auditor_id;
  out.mes_ref = month;
  out.status = normalizeStatus(r[sch.statusCol]);

  out.condominios = condoMap.get(condominio_id) ?? null;
  out.profiles = profMap.get(auditor_id) ?? null;

  // compat (campos antigos vs novos)
  if (out.leitura_agua === undefined && out.agua_leitura !== undefined) out.leitura_agua = out.agua_leitura;
  if (out.leitura_energia === undefined && out.energia_leitura !== undefined) out.leitura_energia = out.energia_leitura;
  if (out.leitura_gas === undefined && out.gas_leitura !== undefined) out.leitura_gas = out.gas_leitura;

  return out;
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;

  // auditor pode listar as auditorias DELE
  const canAuditor = role === "auditor";
  // interno/gestor podem listar todas
  const canStaff = roleGte(role, "interno");

  if (!canAuditor && !canStaff) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const sch = await detectSchema(admin);

    let q = admin.from(sch.table).select("*").order(sch.monthCol, { ascending: false });

    if (canAuditor && !canStaff) {
      // Regra: auditor enxerga auditorias explicitamente atribuídas (auditor_id)
      // E também auditorias dos condomínios atribuídos a ele via public.auditor_condominios
      const { data: acRows, error: acErr } = await admin
        .from("auditor_condominios")
        .select("condominio_id")
        .eq("auditor_id", ctx.user.id);

      if (acErr) return NextResponse.json({ error: acErr.message }, { status: 400 });

      const condoIds = Array.from(new Set((acRows ?? []).map((r: any) => r.condominio_id).filter(Boolean)));
      const quotedCondoIds = condoIds.map((id) => `"${id}"`).join(",");

      if (condoIds.length) {
        // PostgREST OR syntax: col.eq.value,col.in.(v1,v2,...)
        q = q.or(`${sch.auditorCo
