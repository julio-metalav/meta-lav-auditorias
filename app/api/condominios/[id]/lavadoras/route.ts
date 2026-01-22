export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _req: Request,
  ctx: { params: { id: string } }
) {
  const condominioId = ctx.params.id;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return bad("Supabase env vars ausentes", 500);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("condominio_maquinas")
    .select("quantidade")
    .eq("condominio_id", condominioId)
    .eq("categoria", "lavadora")
    .eq("ativo", true);

  if (error) {
    return bad("Erro ao consultar máquinas", 500);
  }

  const count =
    data?.reduce((acc, row) => acc + Number(row.quantidade || 0), 0) ?? 0;

  return NextResponse.json({ count });
}
