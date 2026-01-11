export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function deny(reason: string) {
  // ✅ NÃO vaza segredo. Só explica a causa.
  return NextResponse.json({ error: "Não autenticado", reason }, { status: 401 });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const secret = (process.env.CRON_SECRET ?? "").trim();

  // 🔎 Diagnóstico claro
  if (!secret) return deny("CRON_SECRET ausente no ambiente deste deploy (Vercel env var não aplicada / sem redeploy)");
  if (!token) return deny("Header Authorization ausente (precisa de 'Authorization: Bearer <segredo>')");
  if (token !== secret) return deny("Token inválido (segredo diferente do CRON_SECRET deste deploy)");

  const admin = supabaseAdmin();

  const body = await safeJson(req);
  const forcedMesRef = body?.mes_ref ? String(body.mes_ref) : null;
  const mes_ref = forcedMesRef ?? monthISO(new Date());

  // ✅ 1) Carregar condomínios ativos
  let condos: Array<{ id: string }> = [];

  const r1 = await admin.from("condominios").select("id, ativo");
  if (!r1.error) {
    const rows = (r1.data ?? []) as any[];
    const ativos = rows.filter((c) => c?.ativo === true).map((c) => ({ id: String(c.id) }));
    condos = ativos;
  } else {
    const r2 = await admin.from("condominios").select("id");
    if (r2.error) {
      return NextResponse.json(
        { error: "Falha ao listar condomínios", details: r2.error.message },
        { status: 500 }
      );
    }
    condos = (r2.data ?? []).map((c: any) => ({ id: String(c.id) }));
  }

  if (!condos.length) {
    return NextResponse.json({
      ok: true,
      mes_ref,
      created: 0,
      note: "Nenhum condomínio encontrado (ou nenhum ativo).",
      at: nowIso(),
    });
  }

  // ✅ 2) Upsert das auditorias do mês (idempotente)
  const payloadBase = condos.map((c) => ({
    condominio_id: c.id,
    mes_ref,
    ano_mes: mes_ref,
    status: "aberta",
  }));

  const CHUNK = 200;
  let upserted = 0;

  for (let i = 0; i < payloadBase.length; i += CHUNK) {
    const chunk = payloadBase.slice(i, i + CHUNK);

    const a = await admin
      .from("auditorias")
      .upsert(chunk as any, { onConflict: "condominio_id,mes_ref", ignoreDuplicates: false })
      .select("id");

    if (!a.error) {
      upserted += (a.data ?? []).length;
      continue;
    }

    const chunkB = chunk.map(({ ano_mes, ...rest }) => rest);
    const b = await admin
      .from("auditorias")
      .upsert(chunkB as any, { onConflict: "condominio_id,mes_ref", ignoreDuplicates: false })
      .select("id");

    if (b.error) {
      return NextResponse.json(
        { error: "Falha ao criar/upsert auditorias", details: b.error.message, mes_ref },
        { status: 500 }
      );
    }

    upserted += (b.data ?? []).length;
  }

  return NextResponse.json({
    ok: true,
    mes_ref,
    condominios: condos.length,
    upserted,
    at: nowIso(),
  });
}
