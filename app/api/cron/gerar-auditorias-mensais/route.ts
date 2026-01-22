export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function getToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();

  const x = req.headers.get("x-cron-secret");
  if (x) return x.trim();

  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  if (q) return q.trim();

  return "";
}

function yyyymm01(d: Date) {
  const year = d.getFullYear();
  const month = d.getMonth();
  return new Date(year, month, 1);
}

async function detectMesColumn(supabase: any) {
  // tenta achar a coluna real do mês na tabela auditorias
  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "auditorias")
    .in("column_name", ["ano_mes", "mes_ref"]);

  if (error) return { col: null as string | null, err: error.message };
  const cols = (data || []).map((r: any) => r.column_name);
  if (cols.includes("ano_mes")) return { col: "ano_mes", err: null };
  if (cols.includes("mes_ref")) return { col: "mes_ref", err: null };
  return { col: null, err: null };
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const token = getToken(req);
  const diag = req.nextUrl.searchParams.get("diag") === "1";

  if (!secret) return json(500, { error: "CRON_SECRET ausente no ambiente" });
  if (!token || token !== secret) {
    return json(401, { error: "Não autenticado", ...(diag ? { hasToken: !!token } : {}) });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, {
      error: "Env do Supabase incompleta",
      details: { hasUrl: !!SUPABASE_URL, hasServiceRole: !!SERVICE_ROLE },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const mes = yyyymm01(new Date());
  const mesISO = mes.toISOString().slice(0, 10); // YYYY-MM-DD

  // Detecta coluna do mês (ano_mes ou mes_ref)
  const { col: mesCol, err: detectErr } = await detectMesColumn(supabase);
  if (detectErr) {
    return json(500, { error: "Falha ao detectar coluna do mês em auditorias", details: detectErr });
  }
  if (!mesCol) {
    return json(500, {
      error: "Não encontrei coluna de mês em auditorias (esperado: ano_mes ou mes_ref)",
      ...(diag ? { esperado: ["ano_mes", "mes_ref"] } : {}),
    });
  }

  // Lista condomínios
  const { data: condos, error: condosErr } = await supabase.from("condominios").select("id");
  if (condosErr) {
    return json(500, { error: "Falha ao listar condomínios", details: condosErr.message });
  }
  const condoIds = (condos || []).map((c: any) => c.id).filter(Boolean);
  if (condoIds.length === 0) {
    return json(200, { ok: true, mes: mesISO, created: 0, skipped: 0, note: "Nenhum condomínio" });
  }

  // Auditorias existentes do mês (usando coluna detectada)
  const { data: existing, error: existErr } = await supabase
    .from("auditorias")
    .select("condominio_id")
    .eq(mesCol, mesISO);

  if (existErr) {
    return json(500, {
      error: "Falha ao checar auditorias existentes",
      details: existErr.message,
      ...(diag ? { mesCol, mesISO } : {}),
    });
  }

  const existingSet = new Set((existing || []).map((r: any) => r.condominio_id).filter(Boolean));

  const toCreate = condoIds
    .filter((id: string) => !existingSet.has(id))
    .map((condominio_id: string) => ({
      condominio_id,
      [mesCol]: mesISO,
      status: "rascunho",
      auditor_id: null,
    }));

  if (toCreate.length === 0) {
    return json(200, {
      ok: true,
      mes: mesISO,
      created: 0,
      skipped: condoIds.length,
      idempotente: true,
      ...(diag ? { mesCol, totalCondominios: condoIds.length } : {}),
    });
  }

  const { error: insErr } = await supabase.from("auditorias").insert(toCreate);
  if (insErr) {
    return json(500, {
      error: "Falha ao criar auditorias do mês",
      details: insErr.message,
      ...(diag ? { mesCol, mesISO } : {}),
    });
  }

  return json(200, {
    ok: true,
    mes: mesISO,
    created: toCreate.length,
    skipped: condoIds.length - toCreate.length,
    idempotente: true,
    ...(diag ? { mesCol, totalCondominios: condoIds.length } : {}),
  });
}
