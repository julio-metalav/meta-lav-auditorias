export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

export async function POST(req: Request) {
  try {
    const { role } = await getUserAndRole();
    if (!roleGte(role as Role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const mes_ref = (body?.mes_ref ?? null) as string | null;

    // ✅ supabaseAdmin é uma FUNÇÃO que retorna o client (service role)
    const admin = supabaseAdmin();

    // Executa a função canônica (com log)
    const { data: result, error: rpcErr } = await admin.rpc(
      "criar_auditorias_mensais",
      mes_ref ? { p_mes_ref: mes_ref } : {}
    );

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // Busca os últimos logs (20)
    const { data: logs, error: logErr } = await admin
      .from("auditorias_jobs_log")
      .select("*")
      .order("inicio", { ascending: false })
      .limit(20);

    if (logErr) {
      // Não falha a execução do job por erro de log; só reporta.
      return NextResponse.json({ result, logs: [], log_error: logErr.message });
    }

    return NextResponse.json({ result, logs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
