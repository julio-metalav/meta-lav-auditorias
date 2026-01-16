export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function prevMonthISO(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function pctChange(curr: number, prev: number | null) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === 0) return 0;
    if (v === false) return false;
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mes = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes) {
    return NextResponse.json({ error: "Informe mes_ref no formato YYYY-MM-01" }, { status: 400 });
  }

  const mesAnterior = prevMonthISO(mes);
  const admin = supabaseAdmin();

  // 1) Auditorias do mês
  const { data: auds, error: audErr } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref,status")
    .eq("mes_ref", mes);

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  const auditorias = auds ?? [];
  const condIds = Array.from(new Set(auditorias.map((a: any) => a.condominio_id).filter(Boolean)));

  // 2) Condomínios: usa "*" para NÃO quebrar se alguma coluna não existir
  const condoMap = new Map<string, any>();
  if (condIds.length) {
    const { data: condos, error: condoErr } = await admin.from("condominios").select("*").in("id", condIds);
    if (condoErr) return NextResponse.json({ error: condoErr.message }, { status: 400 });
    for (const c of condos ?? []) condoMap.set((c as any).id, c);
  }

  // 3) Auditorias do mês anterior (pra calcular variação)
  const { data: audPrev } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref")
    .eq("mes_ref", mesAnterior);

  const prevByCondo = new Map<string, any>();
  (audPrev ?? []).forEach((a: any) => prevByCondo.set(a.condominio_id, a));

  // 4) Fonte da verdade: endpoint da auditoria (repassa cookie)
  async function resumoFinanceiro(auditoriaId: string) {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/api/auditorias/${auditoriaId}`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return (json as any)?.data ?? null;
  }

  const resultado: any[] = [];

  for (const aud of auditorias) {
    const resumo = await resumoFinanceiro(aud.id);
    if (!resumo) continue;

    const repasse = Number(resumo?.total_repasse ?? 0);
    const cashback = Number(resumo?.total_cashback ?? 0);
    const totalAtual = repasse + cashback;

    let totalAnterior: number | null = null;
    const prev = prevByCondo.get(aud.condominio_id);
    if (prev?.id) {
      const rPrev = await resumoFinanceiro(prev.id);
      if (rPrev) {
        totalAnterior = Number(rPrev?.total_repasse ?? 0) + Number(rPrev?.total_cashback ?? 0);
      }
    }

    const cond = condoMap.get(aud.condominio_id) ?? {};

    // nomes reais do seu cadastro (com fallback)
    const pix = pickFirst(cond, ["pix", "pix_chave", "chave_pix", "pix_key"]);
    const banco = pickFirst(cond, ["banco", "banco_nome", "banco_codigo", "banco_numero"]);
    const agencia = pickFirst(cond, ["agencia"]);
    const conta = pickFirst(cond, ["conta"]);
    const tipo_conta = pickFirst(cond, ["tipo_conta", "conta_tipo", "conta_tipo", "tipoConta"]);
    const cpf_cnpj = pickFirst(cond, ["favorecido_cnpj", "cpf_cnpj", "cnpj", "cpf"]);
    const titular = pickFirst(cond, ["favorecido", "titular", "titular_nome", "nome_titular"]);

    resultado.push({
      condominio: pickFirst(cond, ["nome"]) ?? null,
      pagamento: { pix, banco, agencia, conta, tipo_conta, cpf_cnpj, titular },
      repasse,
      cashback,
      total: totalAtual,
      variacao_percent: pctChange(totalAtual, totalAnterior), // ✅ só isso aparece pro usuário
    });
  }

  return NextResponse.json({ mes_ref: mes, data: resultado });
}
