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

function asDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function GET() {
  try {
    const { role } = await getUserAndRole();
    if (!roleGte(role as Role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const mes_ref = monthISO();

    // Auditorias do mês (agrega por status)
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

    // Últimos logs do job (schema pode variar: NÃO ordenar por coluna que pode não existir)
    const { data: rawLogs, error: logErr } = await admin
      .from("auditorias_jobs_log")
      .select("*")
      .limit(50);

    // Se erro (ex: tabela não existe), devolve vazio mas não quebra a tela
    const logs = logErr ? [] : (rawLogs ?? []);

    // Ordena em memória pelo melhor "timestamp" disponível
    logs.sort((a: any, b: any) => {
      const da =
        asDate(a?.inicio) ??
        asDate(a?.inicio_em) ??
        asDate(a?.started_at) ??
        asDate(a?.created_at) ??
        asDate(a?.updated_at);

      const db =
        asDate(b?.inicio) ??
        asDate(b?.inicio_em) ??
        asDate(b?.started_at) ??
        asDate(b?.created_at) ??
        asDate(b?.updated_at);

      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      return tb - ta;
    });

    // Mantém só 20 (como antes)
    const topLogs = logs.slice(0, 20);

    return NextResponse.json({
      mes_ref,
      counts,
      condominios_total: condominios_total ?? 0,
      logs: topLogs,
      logs_error: logErr ? logErr.message : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
