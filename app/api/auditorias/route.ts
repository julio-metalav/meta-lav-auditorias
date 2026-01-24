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

/**
 * Busca emails dos usuários (auth.users) por id.
 * Usa service role (supabaseAdmin) e chama admin.auth.admin.getUserById.
 * Se falhar para algum id, retorna null para aquele id.
 */
async function fetchAuthEmailsByIds(admin: ReturnType<typeof supabaseAdmin>, ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const pairs = await Promise.all(
    uniq.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error) return [id, null] as const;
        const email = (data?.user?.email ?? null) as string | null;
        return [id, email] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );

  return new Map(pairs);
}

/* =========================================================
   GET  /api/auditorias
   ========================================================= */
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

  // Auditor vê:
  // - sem auditor (pool)
  // - atribuídas a ele
  if (isAuditor && !isStaff) {
    q = q.or(`${sch.auditorCol}.is.null,${sch.auditorCol}.eq.${ctx.user.id}`);
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

  // Condos
  const { data: condos } = await (condoIds.length
    ? admin.from("condominios").select("id,nome,cidade,uf").in("id", condoIds)
    : Promise.resolve({ data: [] as any[] }));

  const condoMap = new Map((condos ?? []).map((c: any) => [c.id, c]));

  // ✅ Auditor: agora auditor_id é auth.users.id (não profiles.id).
  // Então:
  // 1) pega email via auth.users
  // 2) busca role em profiles por email (se existir)
  const authEmailMap = auditorIds.length ? await fetchAuthEmailsByIds(admin, auditorIds) : new Map<string, string | null>();
  const emails = Array.from(new Set(Array.from(authEmailMap.values()).filter(Boolean))) as string[];

  const { data: profs } = await (emails.length
    ? admin.from("profiles").select("id,email,role").in("email", emails)
    : Promise.resolve({ data: [] as any[] }));

  const profByEmail = new Map((profs ?? []).map((p: any) => [String(p.email ?? "").toLowerCase(), p]));

  const normalized = list.map((r: any) => {
    const condominio_id = r[sch.condoCol];
    const auditor_id = r[sch.auditorCol] ?? null;

    const auditor_email = auditor_id ? authEmailMap.get(auditor_id) ?? null : null;
    const prof = auditor_email ? profByEmail.get(String(auditor_email).toLowerCase()) ?? null : null;

    return {
      ...r,
      condominio_id,
      auditor_id,
      mes_ref: pickMonthISO(r, sch),
      status: normalizeStatus(r[sch.statusCol]),
      condominios: condoMap.get(condominio_id) ?? null,

      // mantém compatibilidade com UI que espera "profiles"
      profiles: auditor_id
        ? {
            id: auditor_id, // id real do auth.users
            email: auditor_email,
            role: prof?.role ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ data: normalized });
}

/* =========================================================
   POST  /api/auditorias  (CRIAR AUDITORIA)
   ========================================================= */
export async function POST(req: Request) {
  try {
    const ctx = await getUserAndRole();
    if (!ctx?.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const role = (ctx.role ?? null) as Role | null;
    const isStaff = roleGte(role, "interno");
    if (!isStaff) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const condominio_id = String(body?.condominio_id ?? "").trim();
    const mes_ref = String(body?.mes_ref ?? "").trim(); // YYYY-MM-01
    const status = normalizeStatus(body?.status ?? "aberta");

    if (!condominio_id) {
      return NextResponse.json({ error: "condominio_id é obrigatório" }, { status: 400 });
    }
    if (!mes_ref) {
      return NextResponse.json({ error: "mes_ref é obrigatório" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const sch = await detectSchema(admin);

    const insertRow: any = {
      [sch.condoCol]: condominio_id,
      [sch.monthCol]: mes_ref,
      [sch.statusCol]: status,
      [sch.auditorCol]: null, // pool
    };

    const { data, error } = await admin
      .from(sch.table)
      .insert([insertRow])
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
