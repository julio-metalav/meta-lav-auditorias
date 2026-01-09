export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim();
  // aceita variações comuns
  if (s === "em conferencia") return "em_conferencia";
  if (s === "em-conferencia") return "em_conferencia";
  if (s === "em_conferencia") return "em_conferencia";
  if (s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

function isMonth01(iso: string) {
  return /^\d{4}-\d{2}-01$/.test(iso);
}

export async function GET() {
  const ctx = await getUserAndRole();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { supabase, role } = ctx;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("auditorias")
    .select(
      `
      id,
      condominio_id,
      auditor_id,
      ano_mes,
      status,
      condominios:condominio_id ( nome, cidade, uf ),
      profiles:auditor_id ( email )
    `
    )
    .order("ano_mes", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await getUserAndRole();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { supabase, role } = ctx;
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const condominio_id = String(body?.condominio_id ?? "").trim();
  const ano_mes = String(body?.ano_mes ?? body?.mes_ref ?? "").trim(); // aceita mes_ref também
  const auditor_id = body?.auditor_id ? String(body.auditor_id).trim() : null;

  // default: aberta (isso é o que estava falhando pra você)
  const status = normalizeStatus(body?.status);

  if (!condominio_id || !ano_mes || !auditor_id) {
    return NextResponse.json(
      { error: "Campos obrigatórios: condominio_id, mes_ref (ex: 2026-01-01), auditor_id" },
      { status: 400 }
    );
  }

  if (!isMonth01(ano_mes)) {
    return NextResponse.json(
      { error: "mes_ref inválido. Use sempre YYYY-MM-01 (ex: 2026-01-01)" },
      { status: 400 }
    );
  }

  // evita duplicar auditoria do mesmo condomínio no mesmo mês
  const { data: exists } = await supabase
    .from("auditorias")
    .select("id")
    .eq("condominio_id", condominio_id)
    .eq("ano_mes", ano_mes)
    .maybeSingle();

  if (exists?.id) {
    return NextResponse.json(
      { error: `Já existe auditoria para este condomínio em ${ano_mes}` },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("auditorias")
    .insert({
      condominio_id,
      ano_mes,
      auditor_id,
      status, // agora aceita 'aberta' sem erro
    })
    .select("id, condominio_id, auditor_id, ano_mes, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data);
}
