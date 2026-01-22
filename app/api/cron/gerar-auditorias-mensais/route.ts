export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import crypto from "crypto";

function sha256(s: string) {
  return crypto.createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
}

function norm(s: string | null | undefined) {
  return String(s ?? "").trim();
}

function takeBearerOrRaw(auth: string | null) {
  const raw = norm(auth);
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw;
}

function pickReqToken(req: Request) {
  const url = new URL(req.url);

  // 1) Authorization: Bearer TOKEN
  const t1 = takeBearerOrRaw(req.headers.get("authorization"));
  if (t1) return { token: t1, source: "authorization" as const };

  // 2) x-cron-secret: TOKEN
  const t2 = norm(req.headers.get("x-cron-secret"));
  if (t2) return { token: t2, source: "x-cron-secret" as const };

  // 3) ?token=TOKEN
  const t3 = norm(url.searchParams.get("token"));
  if (t3) return { token: t3, source: "query" as const };

  return { token: "", source: "none" as const };
}

function pickEnvToken() {
  // aceita CRON_SECRET = "TOKEN" ou "Bearer TOKEN"
  const raw = norm(process.env.CRON_SECRET);
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
  return { raw, token };
}

function isEmergencyOk(req: Request) {
  const pinEnv = norm(process.env.EMERGENCY_PIN);
  if (!pinEnv) return false;
  const pinReq = norm(req.headers.get("x-emergency-pin"));
  return !!pinReq && pinReq === pinEnv;
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

type CondoRow = { id: string; ativo: boolean | null };
type AssignRow = { condominio_id: string; auditor_id: string };

export async function POST(req: Request) {
  const url = new URL(req.url);
  const wantDiag = url.searchParams.get("diag") === "1";

  // --- DIAG: libera se emergency pin bater (mesmo sem token correto)
  if (wantDiag && isEmergencyOk(req)) {
    const reqTok = pickReqToken(req);
    const envTok = pickEnvToken();

    return NextResponse.json({
      ok: true,
      diag: true,
      received: {
        source: reqTok.source,
        token_len: reqTok.token.length,
        token_sha256: reqTok.token ? sha256(reqTok.token) : null,
      },
      env: {
        cron_secret_is_set: !!norm(process.env.CRON_SECRET),
        cron_secret_raw_len: envTok.raw.length,
        cron_secret_token_len: envTok.token.length,
        cron_secret_token_sha256: envTok.token ? sha256(envTok.token) : null,
        emergency_pin_is_set: !!norm(process.env.EMERGENCY_PIN),
      },
      headers_seen: {
        has_authorization: !!norm(req.headers.get("authorization")),
        has_x_cron_secret: !!norm(req.headers.get("x-cron-secret")),
        has_x_emergency_pin: !!norm(req.headers.get("x-emergency-pin")),
      },
    });
  }

  // --- AUTH normal (exige CRON_SECRET)
  const envTok = pickEnvToken();
  if (!envTok.token) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  }

  const reqTok = pickReqToken(req);
  if (!reqTok.token || reqTok.token !== envTok.token) {
    if (wantDiag) {
      return NextResponse.json(
        {
          error: "Não autenticado",
          diag_hint: "Use x-emergency-pin correto para liberar diag=1",
          received: {
            source: reqTok.source,
            token_len: reqTok.token.length,
            token_sha256: reqTok.token ? sha256(reqTok.token) : null,
          },
          env: { cron_secret_token_len: envTok.token.length, cron_secret_token_sha256: sha256(envTok.token) },
        },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  // --- Supabase Admin client
  const sb = supabaseAdmin();

  // --- mês (corrente)
  const mes_ref = monthISO(new Date());

  // --- condomínios ativos
  const r1 = await sb.from("condominios").select("id, ativo");
  if (r1.error) return NextResponse.json({ error: r1.error.message }, { status: 500 });

  const condos = (r1.data ?? []) as CondoRow[];
  const ativos = condos.filter((c) => c?.ativo === true).map((c) => String(c.id));

  if (ativos.length === 0) {
    return NextResponse.json({ ok: true, mes_ref, criadas: 0, msg: "Nenhum condomínio ativo." });
  }

  // ✅ NOVO: mapear auditor padrão por condominio (auditor_condominios)
  // Obs: se não existir vínculo, auditor_id fica null (normal).
  const rA = await sb
    .from("auditor_condominios")
    .select("condominio_id, auditor_id")
    .in("condominio_id", ativos);

  if (rA.error) return NextResponse.json({ error: rA.error.message }, { status: 500 });

  const assigns = (rA.data ?? []) as AssignRow[];
  const auditorByCondo = new Map<string, string>();
  for (const a of assigns) {
    if (a?.condominio_id && a?.auditor_id) auditorByCondo.set(String(a.condominio_id), String(a.auditor_id));
  }

  // --- auditorias do mês (idempotente)
  // ✅ auditoria nova já nasce com auditor_id do vínculo (sem sobrescrever auditorias já existentes)
  const payload = ativos.map((condominio_id) => ({
    condominio_id,
    mes_ref,
    status: "aberta",
    auditor_id: auditorByCondo.get(condominio_id) ?? null,
  }));

  const r2 = await sb
    .from("auditorias")
    .upsert(payload as any, { onConflict: "condominio_id,mes_ref", ignoreDuplicates: true })
    .select("id");

  if (r2.error) return NextResponse.json({ error: r2.error.message }, { status: 500 });

  const criadas = Array.isArray(r2.data) ? r2.data.length : 0;

  return NextResponse.json({
    ok: true,
    mes_ref,
    criadas,
    total_condominios_ativos: ativos.length,
    total_vinculos_encontrados: assigns.length,
  });
}
