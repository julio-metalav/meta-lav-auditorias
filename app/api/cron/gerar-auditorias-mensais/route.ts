export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * CRON mensal — cria auditorias do mês de forma idempotente.
 *
 * Regras:
 * 1) Só cria auditoria para condomínio ATIVO (condominios.ativo = true)
 * 2) Se existir atribuição em public.auditor_condominios para o condomínio -> nasce com auditor_id
 * 3) Se não existir -> auditor_id = null (vai pro pool)
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
    return json(401, {
      error: "Não autenticado",
      ...(diag ? { hasToken: !!token, tokenLen: token?.length || 0 } : {}),
    });
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

  // mês alvo
  const mes = yyyymm01(new Date());
  const mesISO = mes.toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) lista somente condomínios ATIVOS
  const { data: condos, error: condosErr } = await supabase
    .from("condominios")
    .select("id")
    .eq("ativo", true);

  if (condosErr) {
    return json(500, {
      error: "Falha ao listar condomínios ativos",
      details: condosErr.message,
    });
  }

  const condoIds = (condos || []).map((c: any) => c.id).filter(Boolean);

  if (condoIds.length === 0) {
    return json(200, {
      ok: true,
      mes: mesISO,
      created: 0,
      skipped: 0,
      note: "Nenhum condomínio ativo",
    });
  }

  // 2) detecta coluna do mês por tentativa (sem information_schema)
  let mesCol: "ano_mes" | "mes_ref" = "ano_mes";
  let existing: any[] = [];

  const r1 = await supabase
    .from("auditorias")
    .select("condominio_id")
    .eq("ano_mes", mesISO);

  if (!r1.error) {
    mesCol = "ano_mes";
    existing = r1.data || [];
  } else {
    const msg1 = String(r1.error.message || "");
    if (msg1.includes("does not exist") || msg1.includes("não existe")) {
      const r2 = await supabase
        .from("auditorias")
        .select("condominio_id")
        .eq("mes_ref", mesISO);

      if (r2.error) {
        return json(500, {
          error: "Falha ao checar auditorias existentes",
          details: r2.error.message,
          ...(diag ? { tentativasMes: ["ano_mes", "mes_ref"], mesISO } : {}),
        });
      }

      mesCol = "mes_ref";
      existing = r2.data || [];
    } else {
      return json(500, {
        error: "Falha ao checar auditorias existentes",
        details: r1.error.message,
        ...(diag ? { tentativasMes: ["ano_mes"], mesISO } : {}),
      });
    }
  }

  const existingSet = new Set(
    (existing || []).map((r: any) => r.condominio_id).filter(Boolean)
  );

  // 3) pega atribuições (auditor responsável do condomínio)
  const { data: assigns, error: assignsErr } = await supabase
    .from("auditor_condominios")
    .select("condominio_id,auditor_id,created_at")
    .in("condominio_id", condoIds);

  if (assignsErr) {
    return json(500, {
      error: "Falha ao carregar atribuições de auditor (auditor_condominios)",
      details: assignsErr.message,
    });
  }

  const auditorByCondo = new Map<
    string,
    { auditor_id: string; created_at?: string | null }
  >();

  for (const a of assigns || []) {
    const cid = (a as any).condominio_id;
    const aid = (a as any).auditor_id;
    const ca = (a as any).created_at ?? null;
    if (!cid || !aid) continue;

    const prev = auditorByCondo.get(cid);
    if (!prev) {
      auditorByCondo.set(cid, { auditor_id: aid, created_at: ca });
      continue;
    }

    // se tiver created_at, escolhe o mais recente
    if (ca && prev.created_at) {
      if (String(ca) > String(prev.created_at)) {
        auditorByCondo.set(cid, { auditor_id: aid, created_at: ca });
      }
    } else if (ca && !prev.created_at) {
      auditorByCondo.set(cid, { auditor_id: aid, created_at: ca });
    }
  }

  // 4) monta linhas base (com auditor_id conforme atribuição)
  const baseRows = condoIds
    .filter((id: string) => !existingSet.has(id))
    .map((condominio_id: string) => ({
      condominio_id,
      [mesCol]: mesISO,
      auditor_id: auditorByCondo.get(condominio_id)?.auditor_id ?? null,
    }));

  if (baseRows.length === 0) {
    return json(200, {
      ok: true,
      mes: mesISO,
      created: 0,
      skipped: condoIds.length,
      idempotente: true,
      ...(diag ? { mesCol, totalCondominiosAtivos: condoIds.length } : {}),
    });
  }

  // 5) tenta inserir com status permitido (fallback curto e seguro)
  const statusCandidates: Array<string | null> = ["aberta", "rascunho", null];

  let statusUsado: string | null = null;
  let lastErr: string | null = null;

  for (const st of statusCandidates) {
    const rows =
      st === null
        ? baseRows
        : baseRows.map((r) => ({
            ...r,
            status: st,
          }));

    const { error } = await supabase.from("auditorias").insert(rows);

    if (!error) {
      statusUsado = st;
      lastErr = null;
      break;
    }

    lastErr = error.message;

    // se não for erro do CHECK do status, devolve na hora
    const msg = String(error.message || "");
    if (!msg.includes("auditorias_status_check")) {
      return json(500, {
        error: "Falha ao criar auditorias do mês",
        details: error.message,
        ...(diag ? { mesCol, mesISO, tentativaStatus: st } : {}),
      });
    }
  }

  if (lastErr) {
    return json(500, {
      error: "Falha ao criar auditorias do mês",
      details: lastErr,
      ...(diag ? { mesCol, mesISO, statusCandidates } : {}),
    });
  }

  if (!diag) {
    return json(200, {
      ok: true,
      mes: mesISO,
      created: baseRows.length,
      skipped: condoIds.length - baseRows.length,
      idempotente: true,
    });
  }

  const createdWithAuditor = baseRows.filter((r: any) => !!r.auditor_id).length;
  const createdPool = baseRows.length - createdWithAuditor;

  return json(200, {
    ok: true,
    mes: mesISO,
    created: baseRows.length,
    skipped: condoIds.length - baseRows.length,
    idempotente: true,
    mesCol,
    totalCondominiosAtivos: condoIds.length,
    statusUsado,
    atribuicoesEncontradas: (assigns || []).length,
    auditoriasCriadasComAuditor: createdWithAuditor,
    auditoriasCriadasNoPool: createdPool,
  });
}
