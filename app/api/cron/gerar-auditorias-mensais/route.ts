export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * CRON mensal — cria auditorias do mês de forma idempotente.
 *
 * Auth: via secret (header/query) — NÃO usa cookie/session.
 * - Authorization: Bearer <CRON_SECRET>
 * - x-cron-secret: <CRON_SECRET>
 * - ?token=<CRON_SECRET>
 */

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
  const month = d.getMonth(); // 0-based
  return new Date(year, month, 1);
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const token = getToken(req);

  const diag = req.nextUrl.searchParams.get("diag") === "1";

  // build id opcional (se você quiser setar no env BUILD_SHA)
  const build = process.env.BUILD_SHA || undefined;

  if (!secret) {
    return json(500, { error: "CRON_SECRET ausente no ambiente", ...(build ? { build } : {}) });
  }
  if (!token || token !== secret) {
    return json(401, {
      error: "Não autenticado",
      ...(diag ? { hasToken: !!token, tokenLen: token?.length || 0 } : {}),
      ...(build ? { build } : {}),
    });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, {
      error: "Env do Supabase incompleta",
      details: {
        hasUrl: !!SUPABASE_URL,
        hasServiceRole: !!SERVICE_ROLE,
      },
      ...(build ? { build } : {}),
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // mês alvo
  const mes = yyyymm01(new Date());
  const ano_mes = mes.toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) lista condomínios (SEM filtro 'ativo' porque essa coluna não existe)
  const { data: condos, error: condosErr } = await supabase
    .from("condominios")
    .select("id");

  if (condosErr) {
    return json(500, {
      error: "Falha ao listar condomínios",
      details: condosErr.message,
      ...(build ? { build } : {}),
    });
  }

  const condoIds = (condos || []).map((c: any) => c.id).filter(Boolean);

  if (condoIds.length === 0) {
    return json(200, { ok: true, ano_mes, created: 0, skipped: 0, note: "Nenhum condomínio", ...(build ? { build } : {}) });
  }

  // 2) auditorias existentes do mês
  const { data: existing, error: existErr } = await supabase
    .from("auditorias")
    .select("condominio_id")
    .eq("ano_mes", ano_mes);

  if (existErr) {
    return json(500, {
      error: "Falha ao checar auditorias existentes",
      details: existErr.message,
      ...(build ? { build } : {}),
    });
  }

  const existingSet = new Set((existing || []).map((r: any) => r.condominio_id).filter(Boolean));

  const toCreate = condoIds
    .filter((id: string) => !existingSet.has(id))
    .map((condominio_id: string) => ({
      condominio_id,
      ano_mes,
      status: "rascunho",
      auditor_id: null,
    }));

  if (toCreate.length === 0) {
    return json(200, {
      ok: true,
      ano_mes,
      created: 0,
      skipped: condoIds.length,
      idempotente: true,
      ...(diag ? { totalCondominios: condoIds.length } : {}),
      ...(build ? { build } : {}),
    });
  }

  const { error: insErr } = await supabase.from("auditorias").insert(toCreate);

  if (insErr) {
    return json(500, {
      error: "Falha ao criar auditorias do mês",
      details: insErr.message,
      ...(build ? { build } : {}),
    });
  }

  return json(200, {
    ok: true,
    ano_mes,
    created: toCreate.length,
    skipped: condoIds.length - toCreate.length,
    idempotente: true,
    ...(diag ? { totalCondominios: condoIds.length } : {}),
    ...(build ? { build } : {}),
  });
}
