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

type Schema = {
  table: string;
  condoCol: string;
  monthCol: string; // mes_ref OU ano_mes dependendo da tabela
  auditorCol: string; // auditor_id OU user_id
  statusCol: string;
};

async function detectSchema(admin: ReturnType<typeof supabaseAdmin>): Promise<Schema> {
  // ✅ REGRA FIXA DO SEU BANCO: em "auditorias" a coluna correta é mes_ref (NUNCA ano_mes)
  const candidates: Schema[] = [
    // auditorias (real)
    { table: "auditorias", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditorias", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "user_id", statusCol: "status" },

    // tabelas alternativas (legado/compat)
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "user_id", statusCol: "status" },
    { table: "auditoria_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "user_id", statusCol: "status" },

    { table: "auditorias_mes", condoCol: "condominio_id", monthCol: "ano_mes", auditorCol: "auditor_id", statusCol: "status" },
    { table: "auditorias_mes", condoCol: "condominio_id", monthCol: "mes_ref", auditorCol: "auditor_id", statusCol: "status" },
  ];

  for (const c of candidates) {
    const cols = `id,${c.condoCol},${c.monthCol},${c.auditorCol},${c.statusCol}`;
    const { error } = await admin.from(c.table).select(cols).limit(1);
    if (!error) return c;
  }

  throw new Error(
    "Não encontrei uma tabela válida de auditorias. Esperava colunas: id, condominio_id, (mes_ref ou ano_mes), (auditor_id/user_id), status."
  );
}

function normalizeRow(r: any, sch: Schema, condoMap: Map<string, any>, profMap: Map<string, any>) {
  const condominio_id = r[sch.condoCol];
  const auditor_id = r[sch.auditorCol];
  const mes_ref = r[sch.monthCol];
  const status = r[sch.statusCol];

  // ✅ mantém tudo que veio do banco (inclui leituras/fotos/etc)
  const out: any = { ...r };

  // ✅ normaliza chaves que o frontend espera
  out.condominio_id = condominio_id;
  out.auditor_id = auditor_id;

  // ✅ compat mês: frontend pode continuar lendo ano_mes
  out.mes_ref = mes_ref;
  out.ano_mes = mes_ref;

  // ✅ status preservado
  out.status = status;

  // ✅ joins
  out.condominios = condoMap.get(condominio_id) ?? null;
  out.profiles = profMap.get(auditor_id) ?? null;

  // ✅ compat LEITURAS: banco usa agua_leitura/energia_leitura/gas_leitura
  // mas o frontend (auditor/auditoria/[id]) usa leitura_agua/leitura_energia/leitura_gas
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
      q = q.eq(sch.auditorCol, ctx.user.id);
    }

    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const list = rows ?? [];

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

    const normalized = list.map((r: any) => normalizeRow(r, sch, condoMap, profMap));

    // ✅ IMPORTANTE: o frontend espera { data: [...] }
    return NextResponse.json({ data: normalized });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!roleGte(ctx.role as Role | null, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const admin = supabaseAdmin();

  try {
    const sch = await detectSchema(admin);
    const body = await req.json().catch(() => ({}));

    const condominio_id = String(body?.condominio_id ?? "").trim();
    const mes = String(body?.mes_ref ?? body?.ano_mes ?? "").trim(); // aceita os dois, salva no monthCol real
    const auditor_id = String(body?.auditor_id ?? "").trim();
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

    const { data: exists, error: exErr } = await admin
      .from(sch.table)
      .select("id")
      .eq(sch.condoCol, condominio_id)
      .eq(sch.monthCol, mes)
      .maybeSingle();

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
    if (exists?.id) {
      return NextResponse.json({ error: `Já existe auditoria para este condomínio em ${mes}` }, { status: 409 });
    }

    const insertRow: any = {
      [sch.condoCol]: condominio_id,
      [sch.monthCol]: mes,
      [sch.auditorCol]: auditor_id,
      [sch.statusCol]: status,
    };

    const { data, error } = await admin.from(sch.table).insert(insertRow).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // joins mínimos p/ normalização
    const [{ data: condos }, { data: profs }] = await Promise.all([
      admin.from("condominios").select("id,nome,cidade,uf").eq("id", data[sch.condoCol]).maybeSingle(),
      admin.from("profiles").select("id,email,role").eq("id", data[sch.auditorCol]).maybeSingle(),
    ]);

    const condoMap = new Map<string, any>(condos ? [[condos.id, condos]] : []);
    const profMap = new Map<string, any>(profs ? [[profs.id, profs]] : []);

    const normalizedSaved = normalizeRow(data, sch, condoMap, profMap);

    // ✅ IMPORTANTE: frontend normalmente espera { auditoria: ... }
    return NextResponse.json({ auditoria: normalizedSaved });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
