export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function GET() {
  try {
    const { role } = await getUserAndRole();
    if (!roleGte(role as Role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const mes_ref = monthISO();

    // Auditorias do mês (pega só status para agregação)
    const { data: auds, error: audErr } = await admin
      .from("auditorias")
      .select("status")
      .eq("mes_ref", mes_ref);

    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 500 });

    const counts = {
      total: 0,
      aberta: 0,
      em_andamento: 0,
      em_conferencia: 0,
      final: 0,
      outros: 0,
    };

    for (const row of auds ?? []) {
      counts.total += 1;
      const s = String((row as any).status ?? "").trim().toLowerCase();
      if (s === "aberta") counts.aberta += 1;
      else if (s === "em_andamento") counts.em_andamento += 1;
      else if (s === "em_conferencia") counts.em_conferencia += 1;
      else if (s === "final") counts.final += 1;
      else counts.outros += 1;
    }

    // Condomínios (sem depender de coluna "ativo")
    const { count: condominios_total, error: cErr } = await admin
      .from("condominios")
      .select("id", { count: "exact", head: true });

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    // Últimos logs do job (se existir)
    const { data: logs, error: logErr } = await admin
      .from("auditorias_jobs_log")
      .select("*")
      .order("inicio", { ascending: false })
      .limit(20);

    return NextResponse.json({
      mes_ref,
      counts,
      condominios_total: condominios_total ?? 0,
      logs: logErr ? [] : logs,
      logs_error: logErr ? logErr.message : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
