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
  condoCol: string; // condominio_id
  monthCol: string; // mes_ref ou ano_mes
  auditorCol: string; // auditor_id
  statusCol: string; // status
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

function validMonthISO(s: string) {
  return /^\d{4}-\d{2}-01$/.test(s);
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  const isAuditor = role === "auditor";
  const isStaff = roleGte(role, "interno");
  if (!isAuditor && !isStaff) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const sch = await detectSchema(admin);

  // 🔒 Auditor só vê auditorias dos condomínios atribuídos (auditor_condominios)
  let filtroCondoIds: string[] | null = null;

  if (isAuditor && !isStaff) {
    const { data: atribuicoes, error: atrErr } = await admin
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", ctx.user.id);

    if (atrErr) return NextResponse.json({ error: "Falha ao buscar atribuições", details: atrErr.message }, { status: 500 });

    const ids = (atribuicoes ?? []).map((x: any) => x.condominio_id).filter(Boolean);
    filtroCondoIds = ids.length ? ids : [];
  }

  let q = admin.from(sch.table).select("*").order(sch.monthCol, { ascending: false });

  if (filtroCondoIds) {
    // auditor sem atribuição => lista vazia
    if (filtroCondoIds.length === 0) return NextResponse.json({ data: [] });
    q = q.in(sch.condoCol, filtroCondoIds);
  }

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const list = rows ?? [];
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

export async function POST(req: Request) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const sch = await detectSchema(admin);

  const body = await req.json().catch(() => ({}));

  const condominio_id = String(body?.condominio_id ?? "").trim();
  const mes_ref = String(body?.mes_ref ?? body?.ano_mes ?? "").trim();
  const status = normalizeStatus(body?.status ?? "aberta");

  if (!condominio_id) {
    return NextResponse.json({ error: "condominio_id é obrigatório" }, { status: 400 });
  }
  if (!mes_ref || !validMonthISO(mes_ref)) {
    return NextResponse.json({ error: "mes_ref inválido. Use YYYY-MM-01" }, { status: 400 });
  }

  const insertRow: any = {
    [sch.condoCol]: condominio_id,
    [sch.monthCol]: mes_ref,
    [sch.statusCol]: status,
  };

  if (body?.auditor_id) {
    insertRow[sch.auditorCol] = String(body.auditor_id).trim();
  }

  const { data: existing, error: exErr } = await admin
    .from(sch.table)
    .select("id")
    .eq(sch.condoCol, condominio_id)
    .eq(sch.monthCol, mes_ref)
    .maybeSingle();

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
  if (existing?.id) {
    return NextResponse.json({ error: "Já existe auditoria para este condomínio e mês" }, { status: 409 });
  }

  const { data, error } = await admin.from(sch.table).insert(insertRow).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data });
}
