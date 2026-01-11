export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { createHash } from "crypto";

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function getTokenFromAuthHeader(auth: string | null) {
  const raw = String(auth ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw; // se vier sem "Bearer"
}

function isAuthorized(req: Request) {
  const secretRaw = String(process.env.CRON_SECRET ?? "");
  const secret = secretRaw.trim();

  if (!secret) {
    return {
      ok: false,
      code: 500 as const,
      msg: "CRON_SECRET não configurado",
      diag: {
        secret_present: false,
        secret_len: 0,
      },
    };
  }

  const authHeader = req.headers.get("authorization");
  const token = getTokenFromAuthHeader(authHeader).trim();

  // aceita tanto "TOKEN" quanto "Bearer TOKEN" no env
  const envIsBearer = secret.toLowerCase().startsWith("bearer ");
  const envToken = (envIsBearer ? secret.slice(7) : secret).trim();

  const ok = token.length > 0 && token === envToken;

  if (!ok) {
    return {
      ok: false,
      code: 401 as const,
      msg: "Não autenticado",
      diag: {
        auth_header_present: !!authHeader,
        received_token_len: token.length,
        env_token_len: envToken.length,
        received_token_sha256: token ? sha256(token) : null,
        env_token_sha256: envToken ? sha256(envToken) : null,
      },
    };
  }

  return { ok: true, code: 200 as const, msg: "ok", diag: null };
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function POST(req: Request) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.msg, diag: auth.diag }, { status: auth.code });
  }

  const sb = supabaseAdmin();
  const mes_ref = monthISO(new Date());

  const r1 = await sb.from("condominios").select("id, ativo");
  if (r1.error) {
    return NextResponse.json({ error: r1.error.message }, { status: 500 });
  }

  const rows = (r1.data ?? []) as any[];
  const ativos = rows.filter((c) => c?.ativo === true).map((c) => ({ id: String(c.id) }));

  if (ativos.length === 0) {
    return NextResponse.json({ ok: true, mes_ref, criadas: 0, msg: "Nenhum condomínio ativo." });
  }

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
