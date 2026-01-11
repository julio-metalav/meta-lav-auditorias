export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import crypto from "crypto";

function sha256(s: string) {
  return crypto.createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
}

function getTokenFromAuthHeader(auth: string | null) {
  const raw = String(auth ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw; // se vier sem "Bearer"
}

function readAnyToken(req: Request) {
  // Prioridades:
  // 1) Authorization: Bearer TOKEN
  // 2) x-cron-secret: TOKEN
  // 3) ?token=TOKEN
  const authHeader = req.headers.get("authorization");
  const tokenFromAuth = getTokenFromAuthHeader(authHeader);
  if (tokenFromAuth) return tokenFromAuth;

  const x = req.headers.get("x-cron-secret");
  if (x) return String(x).trim();

  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  if (q) return String(q).trim();

  return "";
}

function canSeeDiag(req: Request) {
  // Diagnóstico só com PIN de emergência (para não vazar info de graça)
  const pinEnv = String(process.env.EMERGENCY_PIN ?? "").trim();
  if (!pinEnv) return false;

  const pinHeader = String(req.headers.get("x-emergency-pin") ?? "").trim();
  if (!pinHeader) return false;

  return pinHeader === pinEnv;
}

function isAuthorized(req: Request) {
  const secretRaw = String(process.env.CRON_SECRET ?? "").trim();
  if (!secretRaw) return { ok: false, code: 500 as const, msg: "CRON_SECRET não configurado" };

  // Aceita env com ou sem "Bearer "
  const envIsBearer = secretRaw.toLowerCase().startsWith("bearer ");
  const envToken = (envIsBearer ? secretRaw.slice(7) : secretRaw).trim();

  const token = readAnyToken(req);
  const ok = token && token === envToken;

  if (!ok) return { ok: false, code: 401 as const, msg: "Não autenticado", envToken, token };

  return { ok: true, code: 200 as const, msg: "ok", envToken, token };
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const wantDiag = url.searchParams.get("diag") === "1";

  // 1) Auth
  const auth = isAuthorized(req);

  // Diagnóstico (somente se mandar x-emergency-pin correto)
  if (wantDiag && canSeeDiag(req)) {
    const secretRaw = String(process.env.CRON_SECRET ?? "").trim();
    const envIsBearer = secretRaw.toLowerCase().startsWith("bearer ");
    const envToken = (envIsBearer ? secretRaw.slice(7) : secretRaw).trim();

    const token = readAnyToken(req);

    return NextResponse.json(
      {
        ok_auth: auth.ok,
        // hashes (não expõe segredo)
        envToken_sha256: sha256(envToken),
        reqToken_sha256: sha256(token),
        // metadados úteis
        envToken_len: envToken.length,
        reqToken_len: token.length,
        envStartsWithBearer: envIsBearer,
        hasAuthorizationHeader: !!req.headers.get("authorization"),
        hasXCronSecretHeader: !!req.headers.get("x-cron-secret"),
        hasQueryToken: url.searchParams.has("token"),
        // para pegar pegadinha de espaços
        envToken_preview: envToken.slice(0, 4) + "..." + envToken.slice(-4),
        reqToken_preview: token.slice(0, 4) + "..." + token.slice(-4),
      },
      { status: 200 }
    );
  }

  if (!auth.ok) {
    return NextResponse.json({ error: auth.msg }, { status: auth.code });
  }

  // 2) Supabase Admin client
  const sb = supabaseAdmin();

  // 3) Qual mês criar? (mês corrente, no formato YYYY-MM-01)
  const mes_ref = monthISO(new Date());

  // 4) Pega condomínios ativos
  const r1 = await sb.from("condominios").select("id, ativo");
  if (r1.error) {
    return NextResponse.json({ error: r1.error.message }, { status: 500 });
  }

  const rows = (r1.data ?? []) as any[];
  const ativos = rows.filter((c) => c?.ativo === true).map((c) => ({ id: String(c.id) }));

  if (ativos.length === 0) {
    return NextResponse.json({ ok: true, mes_ref, criadas: 0, msg: "Nenhum condomínio ativo." });
  }

  // 5) Monta auditorias do mês (idempotente)
  // Observação: assume que existe UNIQUE (condominio_id, mes_ref) no banco.
  const payload = ativos.map((c) => ({
    condominio_id: c.id,
    mes_ref,
    status: "aberta",
    auditor_id: null,
  }));

  // 6) Upsert sem sobrescrever (ignora duplicadas)
  const r2 = await sb
    .from("auditorias")
    .upsert(payload as any, { onConflict: "condominio_id,mes_ref", ignoreDuplicates: true })
    .select("id");

  if (r2.error) {
    return NextResponse.json({ error: r2.error.message }, { status: 500 });
  }

  const criadas = Array.isArray(r2.data) ? r2.data.length : 0;

  return NextResponse.json({
    ok: true,
    mes_ref,
    criadas,
    total_condominios_ativos: ativos.length,
  });
}
