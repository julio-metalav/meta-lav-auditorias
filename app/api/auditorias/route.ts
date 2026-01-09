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
  if (s === "em conferencia" || s === "em-conferencia" || s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento" || s === "em-andamento" || s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

function isMonth01(iso: string) {
  return /^\d{4}-\d{2}-01$/.test(iso);
}

async function detectAuditoriasSchema(admin: ReturnType<typeof supabaseAdmin>) {
  // tenta achar qual tabela/colunas existem de verdade
  const candidates = ["auditorias", "auditoria_mes", "auditorias_mes"];

  for (const table of candidates) {
    const { data: cols, error } = await admin
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", table);

    if (error || !cols?.length) continue;

    const set = new Set(cols.map((c: any) => c.column_name));

    const idCol = set.has("id") ? "id" : null;
    const condoCol = set.has("condominio_id") ? "condominio_id" : null;

    // mês pode ter nomes diferentes
    const monthCol =
      set.has("ano_mes") ? "ano_mes" :
      set.has("mes_ref") ? "mes_ref" :
      set.has("mes") ? "mes" :
      set.has("mes_referencia") ? "mes_referencia" :
      null;

    // auditor pode ter nomes diferentes
    const auditorCol =
      set.has("auditor_id") ? "auditor_id" :
      set.has("auditor_user_id") ? "auditor_user_id" :
      set.has("user_id") ? "user_id" :
      null;

    const statusCol = set.has("status") ? "status" : null;

    if (idCol && condoCol && monthCol && auditorCol && statusCol) {
      return { table, idCol, condoCol, monthCol, auditorCol, statusCol };
    }
  }

  throw new Error(
    "Não encontrei uma tabela válida de auditorias. Esperava colunas: id, condominio_id, (ano_mes ou mes_ref), (auditor_id), status."
  );
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { role } = ctx;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();

  try {
    const sch = await detectAuditoriasSchema(admin);

    const { data: rows, error } = await admin
      .from(sch.table)
      .select("*")
      .order(sch.monthCol, { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const list = rows ?? [];

    // busca condomínios e profiles separadamente (sem depender de FK/relationship)
    const condoIds = Array.from(new Set(list.map((r: any) => r[sch.condoCol]).filter(Boolean)));
    const auditorIds = Array.from(new Set(list.map((r: any) => r[sch.auditorCol]).filter(Boolean)));

    const [{ data: condos }, { data: profs }] = await Promise.all([
      condoIds.length
        ? admin.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
        : Promise.resolve({ data: [] as any[] }),
      auditorIds.length
        ? admin.from("profiles").select("id,email,role").in("id", auditorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const condoMap = new Map<string, any>((condos ?? []).map((c: any) => [c.id, c]));
    const profMap = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));

    // normaliza a resposta para o front sempre receber: ano_mes + auditor_id etc
    const normalized = list.map((r: any) => {
      const condominio_id = r[sch.condoCol];
      const auditor_id = r[sch.auditorCol];
      const ano_mes = r[sch.monthCol];
      const status = r[sch.statusCol];

      return {
        id: r[sch.idCol],
        condominio_id,
        auditor_id,
        ano_mes, // sempre devolve com esse nome
        status,
        condominios: condoMap.get(condominio_id) ?? null,
        profiles: profMap.get(auditor_id) ?? null,
      };
    });

    return NextResponse.json(normalized);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await getUserAndRole();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { role } = ctx;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();

  try {
    const sch = await detectAuditoriasSchema(admin);

    const body = await req.json().catch(() => ({}));

    const condominio_id = String(body?.condominio_id ?? "").trim();
    const mes = String(body?.ano_mes ?? body?.mes_ref ?? "").trim();
    const auditor_id = body?.auditor_id ? String(body.auditor_id).trim() : "";

    const status = normalizeStatus(body?.status);

    if (!condominio_id || !mes || !auditor_id) {
      return NextResponse.json(
        { error: "Campos obrigatórios: condominio_id, mes_ref (ex: 2026-01-01), auditor_id" },
        { status: 400 }
      );
    }

    if (!isMonth01(mes)) {
      return NextResponse.json(
        { error: "mes_ref inválido. Use sempre YYYY-MM-01 (ex: 2026-02-01)" },
        { status: 400 }
      );
    }

    // evita duplicar
    const { data: exists } = await admin
      .from(sch.table)
      .select("id")
      .eq(sch.condoCol, condominio_id)
      .eq(sch.monthCol, mes)
      .maybeSingle();

    if (exists?.id) {
      return NextResponse.json(
        { error: `Já existe auditoria para este condomínio em ${mes}` },
        { status: 409 }
      );
    }

    const insertRow: any = {
      [sch.condoCol]: condominio_id,
      [sch.monthCol]: mes,
      [sch.auditorCol]: auditor_id,
      [sch.statusCol]: status,
    };

    const { data, error } = await admin.from(sch.table).insert(insertRow).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      id: data[sch.idCol],
      condominio_id: data[sch.condoCol],
      auditor_id: data[sch.auditorCol],
      ano_mes: data[sch.monthCol],
      status: data[sch.statusCol],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
