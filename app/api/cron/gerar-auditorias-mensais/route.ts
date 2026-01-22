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

function safeEq(a: string, b: string) {
  // evita comparação “estranha” e dá resultado consistente
  const aa = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const wantDiag = url.searchParams.get("diag") === "1";

  const envTok = pickEnvToken();
  const reqTok = pickReqToken(req);

  // --- Se quiser diag, SEMPRE devolve pista (sem vazar segredo em texto)
  // (mostra apenas tamanho e hash)
  const diagPayload = {
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
    },
    headers_seen: {
      has_authorization: !!norm(req.headers.get("authorization")),
      has_x_cron_secret: !!norm(req.headers.get("x-cron-secret")),
    },
  };

  // --- AUTH normal (exige CRON_SECRET)
  if (!envTok.token) {
    return NextResponse.json(
      wantDiag ? { error: "CRON_SECRET não configurado", diag: diagPayload } : { error: "CRON_SECRET não configurado" },
      { status: 500 }
    );
  }

  if (!reqTok.token || !safeEq(reqTok.token, envTok.token)) {
    return NextResponse.json(
      wantDiag
        ? { error: "Não autenticado", diag_hint: "token recebido != token do env (compare sha256)", diag: diagPayload }
        : { error: "Não autenticado" },
      { status: 401 }
    );
  }

  // --- Supabase Admin client
  const sb = supabaseAdmin();

  // --- mês (corrente)
  const mes_ref = monthISO(new Date());

  // --- condomínios ativos
  const r1 = await sb.from("condominios").select("id, ativo");
  if (r1.error) return NextResponse.json({ error: r1.error.message }, { status: 500 });

  const rows = (r1.data ?? []) as any[];
  const ativos = rows.filter((c) => c?.ativo === true).map((c) => ({ id: String(c.id) }));

  if (ativos.length === 0) {
    return NextResponse.json({ ok: true, mes_ref, criadas: 0, msg: "Nenhum condomínio ativo." });
  }

  // --- auditorias do mês (idempotente)
  const payload = ativos.map((c) => ({
    condominio_id: c.id,
    mes_ref,
    status: "aberta",
    auditor_id: null,
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
  });
}
