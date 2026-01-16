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

  let q = admin.from(sch.table).select("*").order(sch.monthCol, { ascending: false });

  // Auditor: auditorias atribuídas a ele OU auditorias dos condomínios vinculados a ele
  if (isAuditor && !isStaff) {
    const { data: ac, error: acErr } = await admin
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", ctx.user.id);

    if (acErr) return NextResponse.json({ error: acErr.message }, { status: 400 });

    const condoIds = Array.from(new Set((ac ?? []).map((r: any) => r.condominio_id).filter(Boolean)));

    if (condoIds.length > 0) {
      // ✅ IMPORTANTÍSSIMO:
      // - não usar aspas dentro do filtro (PostgREST/Supabase)
      // - uuid em in.(...) vai sem aspas
      const inList = condoIds.join(",");
      q = q.or(`${sch.auditorCol}.eq.${ctx.user.id},${sch.condoCol}.in.(${inList})`);
    } else {
      q = q.eq(sch.auditorCol, ctx.user.id);
    }
  }

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const list = rows ?? [];

  const condoIds = Array.from(new Set(list.map((r: any) => r[sch.condoCol]).filter(Boolean)));

  // ✅ Enriquecimento: se auditor_id estiver null, pega do vínculo auditor_condominios (mais recente)
  const condoToAssignedAuditor = new Map<string, string>();
  if (condoIds.length) {
    const { data: links, error: linkErr } = await admin
      .from("auditor_condominios")
      .select("condominio_id,auditor_id,created_at")
      .in("condominio_id", condoIds)
      .order("created_at", { ascending: false });

    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });

    for (const l of links ?? []) {
      const cid = (l as any).condominio_id as string;
      const aid = (l as any).auditor_id as string;
      if (cid && aid && !condoToAssignedAuditor.has(cid)) {
        condoToAssignedAuditor.set(cid, aid); // pega o mais recente
      }
    }
  }

  const effectiveAuditorIds = Array.from(
    new Set(
      list
        .map((r: any) => r[sch.auditorCol] ?? condoToAssignedAuditor.get(r[sch.condoCol]) ?? null)
        .filter(Boolean)
    )
  );

  const [{ data: condos, error: condoErr }, { data: profs, error: profErr }] = await Promise.all([
    condoIds.length
      ? admin.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    effectiveAuditorIds.length
      ? admin.from("profiles").select("id,email,role").in("id", effectiveAuditorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  if (condoErr) return NextResponse.json({ error: condoErr.message }, { status: 400 });
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

  const condoMap = new Map<string, any>((condos ?? []).map((c: any) => [c.id, c]));
  const profMap = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));

  const normalized = list.map((r: any) => {
    const condominio_id = r[sch.condoCol];
    const auditor_id_db = r[sch.auditorCol] ?? null;
    const auditor_id_eff = auditor_id_db ?? condoToAssignedAuditor.get(condominio_id) ?? null;

    return {
      ...r,
      condominio_id,
      // ✅ auditor_id “de exibição” (não altera banco): usa vínculo se estiver null no registro
      auditor_id: auditor_id_eff,
      mes_ref: pickMonthISO(r, sch),
      status: normalizeStatus(r[sch.statusCol]),
      condominios: condoMap.get(condominio_id) ?? null,
      profiles: auditor_id_eff ? profMap.get(auditor_id_eff) ?? null : null,
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

  // Opção A: auditor_id NÃO é obrigatório na criação.
  const insertRow: any = {
    [sch.condoCol]: condominio_id,
    [sch.monthCol]: mes_ref,
    [sch.statusCol]: status,
  };

  // se vier no payload, aceita
  if (body?.auditor_id) {
    insertRow[sch.auditorCol] = String(body.auditor_id).trim();
  }

  // evita duplicidade (condominio + mês)
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
