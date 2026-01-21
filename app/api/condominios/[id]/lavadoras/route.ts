export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function ok(count: number) {
  return NextResponse.json({ count });
}

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(
  _req: Request,
  ctx: { params: { id: string } }
) {
  const id = ctx.params.id;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return bad(
      "Faltam variáveis de ambiente do Supabase (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      500
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // Tentativas (ordem de probabilidade)
  const tries: Array<{
    table: string;
    where: (q: any) => any;
  }> = [
    {
      table: "condominio_maquinas",
      where: (q) =>
        q.eq("condominio_id", id).or("tipo.eq.lavadora,kind.eq.lavadora"),
    },
    {
      table: "condominio_equipamentos",
      where: (q) =>
        q.eq("condominio_id", id).or("tipo.eq.lavadora,kind.eq.lavadora"),
    },
    {
      table: "maquinas",
      where: (q) =>
        q.eq("condominio_id", id).or("tipo.eq.lavadora,kind.eq.lavadora"),
    },
  ];

  for (const t of tries) {
    const { count, error } = await t.where(
      supabase.from(t.table).select("id", { count: "exact", head: true })
    );

    // tabela existe e query ok
    if (!error) return ok(Number(count ?? 0));

    // Se for “tabela não existe”, tenta a próxima.
    // (Postgres: 42P01 = undefined_table)
    const code = (error as any)?.code;
    if (code === "42P01") continue;

    // Outro erro (permissão, coluna, etc.)
    return bad(`Erro ao consultar ${t.table}`, 500, { details: error });
  }

  // Nenhuma tabela encontrada
  return ok(0);
}
