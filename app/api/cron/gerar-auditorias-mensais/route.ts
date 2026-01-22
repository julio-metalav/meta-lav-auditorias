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

  // Mês alvo
  const mes = yyyymm01(new Date());
  const mesISO = mes.toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) Lista condomínios
  const { data: condos, error: condosErr } = await supabase.from("condominios").select("id");
  if (condosErr) {
    return json(500, { error: "Falha ao listar condomínios", details: condosErr.message });
  }
  const condoIds = (condos || []).map((c: any) => c.id).filter(Boolean);

  if (condoIds.length === 0) {
    return json(200, { ok: true, mes: mesISO, created: 0, skipped: 0, note: "Nenhum condomínio" });
  }

  // 2) Descobre coluna do mês por tentativa (sem information_schema)
  let mesCol: "ano_mes" | "mes_ref" = "ano_mes";
  let existing: any[] = [];

  const r1 = await supabase.from("auditorias").select("condominio_id").eq("ano_mes", mesISO);

  if (!r1.error) {
    mesCol = "ano_mes";
    existing = r1.data || [];
  } else {
    const msg1 = String(r1.error.message || "");

    // se a coluna não existe, tenta mes_ref
    if (msg1.includes("does not exist") || msg1.includes("não existe")) {
      const r2 = await supabase.from("auditorias").select("condominio_id").eq("mes_ref", mesISO);

      if (r2.error) {
        return json(500, {
          error: "Falha ao checar auditorias existentes",
          details: r2.error.message,
          ...(diag ? { tentativas: ["ano_mes", "mes_ref"], mesISO } : {}),
        });
      }

      mesCol = "mes_ref";
      existing = r2.data || [];
    } else {
      // erro diferente (permissão, RLS, etc.)
      return json(500, {
        error: "Falha ao checar auditorias existentes",
        details: r1.error.message,
        ...(diag ? { tentativas: ["ano_mes"], mesISO } : {}),
      });
    }
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
