export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { createHash, timingSafeEqual } from "crypto";

function getTokenFromAuthHeader(auth: string | null) {
  const raw = String(auth ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw; // se vier sem "Bearer"
}

function safeEq(a: string, b: string) {
  const aa = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function sha256(s: string) {
  return createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
}

function isAuthorized(req: Request) {
  const secretRaw = String(process.env.CRON_SECRET ?? "");
  const secret = secretRaw.trim();

  if (!secret) {
    return { ok: false as const, code: 500 as const, msg: "CRON_SECRET não configurado" };
  }

  // pega token de 3 lugares (ordem importa):
  // 1) Authorization
  // 2) x-cron-secret
  // 3) query ?secret=...
  const authHeader = req.headers.get("authorization");
  const tokenAuth = getTokenFromAuthHeader(authHeader);

  const tokenHeaderAlt = String(req.headers.get("x-cron-secret") ?? "").trim();

  let tokenQuery = "";
  try {
    const u = new URL(req.url);
    tokenQuery = String(u.searchParams.get("secret") ?? "").trim();
  } catch {
    // ignora
  }

  const token = tokenAuth || tokenHeaderAlt || tokenQuery;

  // aceita tanto "TOKEN" quanto "Bearer TOKEN" no env (pra evitar pegadinha)
  const envIsBearer = secret.toLowerCase().startsWith("bearer ");
  const envToken = (envIsBearer ? secret.slice(7) : secret).trim();

  const ok = !!token && safeEq(token, envToken);
  if (!ok) {
    // Diagnóstico SEM vazar segredo (só tamanhos + presença de headers)
    return {
      ok: false as const,
      code: 401 as const,
      msg: "Não autenticado",
      diag: {
        hasAuthorization: !!authHeader,
        hasXcron: !!tokenHeaderAlt,
        hasQuerySecret: !!tokenQuery,
        tokenLen: token.length,
        envLen: envToken.length,
        // hashes ajudam a comparar sem expor o valor (não é reversível na prática)
        tokenSha256: token ? sha256(token) : null,
        envSha256: envToken ? sha256(envToken) : null,
      },
    };
  }

  return { ok: true as const, code: 200 as const, msg: "ok" };
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function POST(req: Request) {
  // 1) Auth
  const auth = isAuthorized(req);
  if (!auth.ok) {
    // inclui diag só quando 401 (pra gente enxergar o que chegou)
    const body: any = { error: auth.msg };
    if ((auth as any).diag) body.diag = (auth as any).diag;
    return NextResponse.json(body, { status: auth.code });
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
