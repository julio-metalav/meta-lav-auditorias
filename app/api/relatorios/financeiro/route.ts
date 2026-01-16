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
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function pctChange(curr: number, prev: number | null) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role as any, "interno"))
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const url = new URL(req.url);
  const mes = url.searchParams.get("mes_ref");
  if (!mes) {
    return NextResponse.json(
      { error: "Informe mes_ref no formato YYYY-MM-01" },
      { status: 400 }
    );
  }

  const mesAnterior = prevMonthISO(mes);
  const admin = supabaseAdmin();

  // 1️⃣ Auditorias do mês
  const { data: auds, error: audErr } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref,status")
    .eq("mes_ref", mes);

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  const auditorias = auds ?? [];
  const condIds = Array.from(new Set(auditorias.map((a: any) => a.condominio_id)));

  // 2️⃣ Dados dos condomínios (bancário / PIX)
  const { data: condos, error: condoErr } = await admin
    .from("condominios")
    .select(
      [
        "id",
        "nome",
        "tipo_pagamento",
        "banco_nome",
        "banco",
        "agencia",
        "conta",
        "conta_tipo",
        "titular",
        "cpf_cnpj",
        "pix_chave",
        "pix_tipo",
      ].join(",")
    )
    .in("id", condIds);

  if (condoErr) return NextResponse.json({ error: condoErr.message }, { status: 400 });

  const condoMap = new Map(condos.map((c: any) => [c.id, c]));

  // 3️⃣ Auditorias do mês anterior
  const { data: audPrev } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref")
    .eq("mes_ref", mesAnterior);

  const prevByCondo = new Map<string, any>();
  (audPrev ?? []).forEach((a: any) => prevByCondo.set(a.condominio_id, a));

  // 4️⃣ Chama o backend de auditoria (fonte da verdade)
  async function resumoFinanceiro(auditoriaId: string) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auditorias/${auditoriaId}`,
      { headers: { Cookie: req.headers.get("cookie") ?? "" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? null;
  }

  const resultado: any[] = [];

  for (const aud of auditorias) {
    const resumo = await resumoFinanceiro(aud.id);
    if (!resumo) continue;

    const totalAtual =
      Number(resumo?.total_repasse ?? 0) +
      Number(resumo?.total_cashback ?? 0);

    let totalAnterior: number | null = null;
    const prev = prevByCondo.get(aud.condominio_id);
    if (prev) {
      const rPrev = await resumoFinanceiro(prev.id);
      if (rPrev) {
        totalAnterior =
          Number(rPrev?.total_repasse ?? 0) +
          Number(rPrev?.total_cashback ?? 0);
      }
    }

    const cond = condoMap.get(aud.condominio_id);

    resultado.push({
      condominio: cond?.nome,
      pagamento: {
        tipo: cond?.tipo_pagamento,
        banco: cond?.banco_nome ?? cond?.banco ?? null,
        agencia: cond?.agencia ?? null,
        conta: cond?.conta ?? null,
        pix: cond?.pix_chave ?? null,
        titular: cond?.titular ?? null,
        cpf_cnpj: cond?.cpf_cnpj ?? null,
      },
      repasse: Number(resumo?.total_repasse ?? 0),
      cashback: Number(resumo?.total_cashback ?? 0),
      total: totalAtual,
      mes_anterior: totalAnterior,
      variacao_percent: pctChange(totalAtual, totalAnterior),
    });
  }

  return NextResponse.json({ mes_ref: mes, data: resultado });
}
