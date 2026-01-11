export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";

function getTokenFromAuthHeader(auth: string | null) {
  const raw = String(auth ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw; // se vier sem "Bearer"
}

function isAuthorized(req: Request) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) return { ok: false, code: 500 as const, msg: "CRON_SECRET não configurado" };

  const authHeader = req.headers.get("authorization");
  const token = getTokenFromAuthHeader(authHeader);

  // aceita tanto "TOKEN" quanto "Bearer TOKEN" no env (pra evitar pegadinha)
  const envIsBearer = secret.toLowerCase().startsWith("bearer ");
  const envToken = envIsBearer ? secret.slice(7).trim() : secret;

  const ok = token && token === envToken;
  if (!ok) return { ok: false, code: 401 as const, msg: "Não autenticado" };

  return { ok: true, code: 200 as const, msg: "ok" };
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
