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
  if (["aberta", "em_andamento", "em_conferencia", "final"].includes(s)) return s as Status;
  return "aberta";
}

type Schema = {
  table: string;
  condoCol: string;   // condominio_id
  monthCol: string;   // mes_ref ou ano_mes
  auditorCol: string; // auditor_id
  statusCol: string;  // status
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

function pickMonthISO(row: any, sch: Schema) {
  const raw = row?.[sch.monthCol];
  return raw ? String(raw) : null;
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = ctx.role as Role | null;
  const isAuditor = role === "auditor";
  const isStaff = roleGte(role, "interno");

  if (!isAuditor && !isStaff) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const sch = await detectSchema(admin);

  let query = admin.from(sch.table).select("*").order(sch.monthCol, { ascending: false });

  // Auditor: vê auditorias atribuídas a ele OU auditorias de condomínios atribuídos a ele (auditor_condominios)
  if (isAuditor && !isStaff) {
    const { data: ac, error: acErr } = await admin
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", ctx.user.id);

    if (acErr) return NextResponse.json({ error: acErr.message }, { status: 400 });

    const condoIds = Array.from(new Set((ac ?? []).map((r: any) => r.condominio_id).filter(Boolean)));

    if (condoIds.length > 0) {
      const inList = condoIds.map((id) => `"${id}"`).join(",");
      query = query.or(`${sch.auditorCol}.eq."${ctx.user.id}",${sch.condoCol}.in.(${inList})`);
    } else {
      query = query.eq(sch.auditorCol, ctx.user.id);
    }
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const list = rows ?? [];

  // Enriquecimento: buscar nome/cidade/uf do condomínio e email do auditor
  const condoIds = Array.from(new Set(list.map((r: any) => r[sch.condoCol]).filter(Boolean)));
  const auditorIds = Array.from(new Set(list.map((r: any) => r[sch.auditorCol]).filter(Boolean)));

  const [{ data: condos, error: condoErr }, { data: profs, error: profErr }] = await Promise.all([
    condoIds.length
      ? admin.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    auditorIds.length
      ? admin.from("profiles").select("id,email,role").in("id", auditorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  if (condoErr) return NextResponse.json({ error: condoErr.message }, { status: 400 });
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

  const condoMap = new Map<string, any>((condos ?? []).map((c: any) => [c.id, c]));
  const profMap = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));

  const normalized = list.map((r: any) => {
    const condominio_id = r[sch.condoCol];
    const auditor_id = r[sch.auditorCol];

    return {
      ...r,

      // garante campos que a UI usa
      condominio_id,
      auditor_id: auditor_id ?? null,
      mes_ref: pickMonthISO(r, sch),
      status: normalizeStatus(r[sch.statusCol]),

      // joi
