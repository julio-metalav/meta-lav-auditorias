export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

export async function POST() {
  try {
    const { user, role } = await getUserAndRole();

    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    if (!roleGte(role as Role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // ✅ supabaseAdmin é FUNÇÃO -> precisa chamar
    const admin = supabaseAdmin();

    // Executa a função canônica (com log)
    const { data: result, error: rpcErr } = await admin.rpc("criar_auditorias_mensais");
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // Retorna logs recentes
    const { data: logs, error: logErr } = await admin
      .from("auditorias_jobs_log")
      .select(
        "id, job_name, mes_ref, started_at, finished_at, ok, condominios_ativos, criadas, result, error_message"
      )
      .order("started_at", { ascending: false })
      .limit(20);

    if (logErr) {
      return NextResponse.json({ result, logs: [], log_error: logErr.message }, { status: 200 });
    }

    return NextResponse.json({ result, logs }, { status: 200 });
  } catch (e: any) {
    if (String(e?.message ?? "") === "NOT_AUTHENTICATED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
