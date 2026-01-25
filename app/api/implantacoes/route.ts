export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function canAccess(role: Role | null) {
  return role === "interno" || role === "gestor";
}

// aceita "YYYY-MM-DD" (input date) ou "DD/MM/YYYY"
function normalizeDate(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

export async function GET() {
  try {
    const { role } = await getUserAndRole();
    if (!canAccess(role as Role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const admin = supabaseAdmin();

    // "ativos": não finalizadas OU finalizadas nos últimos 10 dias
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from("implantacoes")
      .select("id, nome_condominio, endereco, data_contrato, finalizada_em, created_at")
      .or(`finalizada_em.is.null,finalizada_em.gte.${cutoff}`)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { role } = await getUserAndRole();
    if (!canAccess(role as Role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));
    const nome_condominio = String(body?.nome_condominio ?? "").trim();
    const endereco = String(body?.endereco ?? "").trim() || null;
    const data_contrato = normalizeDate(body?.data_contrato);

    if (!nome_condominio || !data_contrato) {
      return NextResponse.json(
        { error: "Nome do condomínio e data do contrato são obrigatórios" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // 1) cria implantação
    const { data: implantacao, error: impErr } = await admin
      .from("implantacoes")
      .insert({ nome_condominio, endereco, data_contrato })
      .select("id")
      .single();

    if (impErr || !implantacao?.id) {
      return NextResponse.json({ error: impErr?.message ?? "Erro ao criar implantação" }, { status: 500 });
    }

    const implantacao_id = implantacao.id as string;

    // 2) carrega checklist padrão
    const { data: padrao, error: padErr } = await admin
      .from("implantacao_checklist_padrao")
      .select("secao, descricao, ordem")
      .eq("ativo", true)
      .order("secao", { ascending: true })
      .order("ordem", { ascending: true });

    if (padErr) return NextResponse.json({ error: padErr.message }, { status: 500 });

    // 3) copia itens para a implantação
    if (padrao?.length) {
      const itens = padrao.map((p: any) => ({
        implantacao_id,
        secao: p.secao,
        descricao: p.descricao,
        ordem: p.ordem,
        status: "pendente", // vermelho
        observacao: null,   // observação por item (como você pediu)
      }));

      const { error: chkErr } = await admin.from("implantacao_checklist").insert(itens);
      if (chkErr) return NextResponse.json({ error: chkErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, implantacao_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
