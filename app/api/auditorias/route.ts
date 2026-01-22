export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
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

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  if (!s) return "aberta";
  return s;
}

function pickMonthISO(row: any, sch: Schema) {
  const raw = row?.[sch.monthCol];
  return raw ? String(raw) : null;
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const role = (ctx.role ?? null) as Role | null;
  const isAuditor = role === "auditor";
  const isStaff = roleGte(role, "interno");

  if (!isAuditor && !isStaff) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const sch = await detectSchema(admin);

  let q = admin
    .from(sch.table)
    .select("*")
    .order(sch.monthCol, { ascending: false });

  // ✅ REGRA FINAL:
  // Auditor vê:
  // - auditorias SEM auditor (fila aberta)
  // - auditorias atribuídas A ELE
  // Não vê auditorias atribuídas a outros
  if (isAuditor && !isStaff) {
    q = q.or(
      `${sch.auditorCol}.is.null,${sch.auditorCol}.eq.${ctx.user.id}`
    );
  }

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const list = rows ?? [];

  const condoIds = Array.from(
    new Set(list.map((r: any) => r[sch.condoCol]).filter(Boolean))
  );
  const auditorIds = Array.from(
    new Set(list.map((r: any) => r[sch.auditorCol]).filter(Boolean))
  );

  const [{ data: condos }, { data: profs }] = await Promise.all([
    condoIds.length
      ? admin.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
      : Promise.resolve({ data: [] }),
    auditorIds.length
      ? admin.from("profiles").select("id,email,role").in("id", auditorIds)
      : Promise.resolve({ data: [] }),
  ]);

  const condoMap = new Map((condos ?? []).map((c: any) => [c.id, c]));
  const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

  const normalized = list.map((r: any) => {
    const condominio_id = r[sch.condoCol];
    const auditor_id = r[sch.auditorCol] ?? null;

    return {
      ...r,
      condominio_id,
      auditor_id,
      mes_ref: pickMonthISO(r, sch),
      status: normalizeStatus(r[sch.statusCol]),
      condominios: condoMap.get(condominio_id) ?? null,
      profiles: auditor_id ? profMap.get(auditor_id) ?? null : null,
    };
  });

  return NextResponse.json({ data: normalized });
}
