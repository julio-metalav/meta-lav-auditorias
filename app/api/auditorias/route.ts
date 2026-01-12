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
  if (["aberta", "em_andamento", "em_conferencia", "final"].includes(s)) {
    return s as Status;
  }
  return "aberta";
}

type Schema = {
  table: string;
  condoCol: string;
  monthCol: string;
  auditorCol: string;
  statusCol: string;
};

async function detectSchema(admin: ReturnType<typeof supabaseAdmin>): Promise<Schema> {
  const candidates: Schema[] = [
    { table: "auditorias", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditorias_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
  ];

  for (const c of candidates) {
    const { error } = await admin.from(c.table).select(c.condoCol).limit(1);
    if (!error) return c;
  }

  throw new Error("Nenhuma tabela de auditorias válida encontrada");
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const role = ctx.role as Role | null;
  const isAuditor = role === "auditor";
  const isStaff = roleGte(role, "interno");

  if (!isAuditor && !isStaff) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const sch = await detectSchema(admin);

  let query = admin.from(sch.table).select("*").order(sch.monthCol, { ascending: false });

  if (isAuditor && !isStaff) {
    const { data: rows, error } = await admin
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", ctx.user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const condoIds = Array.from(new Set((rows ?? []).map(r => r.condominio_id)));

    if (condoIds.length > 0) {
      const inList = condoIds.map(id => `"${id}"`).join(",");
      query = query.or(
        `${sch.auditorCol}.eq."${ctx.user.id}",${sch.condoCol}.in.(${inList})`
      );
    } else {
      query = query.eq(sch.auditorCol, ctx.user.id);
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data: data ?? [] });
}
