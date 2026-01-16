export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return s || "aberta";
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

function firstNonEmpty(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function buildPagamentoString(cond: any) {
  // tenta achar pix primeiro
  const pix = firstNonEmpty(cond, ["pix", "pix_chave", "pix_key", "pix_chave_copia_cola"]);
  const cpfCnpj = firstNonEmpty(cond, ["cpf_cnpj", "cnpj", "cnpj_cpf", "favorecido_cnpj", "cpf", "documento"]);
  const bancoCod = firstNonEmpty(cond, ["banco", "banco_codigo", "banco_cod", "codigo_banco"]);
  const bancoNome = firstNonEmpty(cond, ["banco_nome", "banco_name"]);
  const agencia = firstNonEmpty(cond, ["agencia", "agência"]);
  const conta = firstNonEmpty(cond, ["conta", "conta_numero", "numero_conta"]);

  if (pix) {
    return `PIX: ${pix}${cpfCnpj ? ` • CNPJ/CPF: ${cpfCnpj}` : ""}`;
  }

  const bancoLabel =
    bancoCod && bancoNome ? `${bancoNome} (${bancoCod})` : (bancoCod ? `Banco (${bancoCod})` : (bancoNome ? bancoNome : "Banco"));

  const partes: string[] = [];
  partes.push(`${bancoLabel}`);
  if (agencia) partes.push(`Agência: ${agencia}`);
  if (conta) partes.push(`Conta: ${conta}`);
  if (cpfCnpj) partes.push(`CNPJ/CPF: ${cpfCnpj}`);

  // se não tiver nada mesmo, devolve vazio
  const joined = partes.join(" • ").trim();
  return joined === "Banco" ? "" : joined;
}

/**
 * 🔎 Busca totais do financeiro da auditoria.
 * Preferência: /api/auditorias/[id]/ciclos (normalmente já tem resumo pronto).
 * Fallback: /api/auditorias/[id] (se algum ambiente não tiver ciclos).
 */
async function fetchTotaisFinanceiros(origin: string, auditoriaId: string, cookieHeader: string) {
  const tryUrls = [
    `${origin}/api/auditorias/${auditoriaId}/ciclos`,
    `${origin}/api/auditorias/${auditoriaId}`,
  ];

  for (const u of tryUrls) {
    const res = await fetch(u, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) continue;

    const j = await res.json().catch(() => null);
    const data = j?.data ?? j?.auditoria ?? j ?? null;
    if (!data) continue;

    // Tentativas de nomes de campos (bem defensivo)
    const repasse =
      Number(
        data?.total_repasse ??
          data?.repasse_total ??
          data?.repasse ??
          data?.resumo_financeiro?.repasse_total ??
          data?.resumo_financeiro?.total_repasse ??
          0
      ) || 0;

    const cashback =
      Number(
        data?.total_cashback ??
          data?.cashback_total ??
          data?.cashback ??
          data?.resumo_financeiro?.cashback_total ??
          data?.resumo_financeiro?.total_cashback ??
          0
      ) || 0;

    const total =
      Number(
        data?.total ??
          data?.total_a_pagar ??
          data?.resumo_financeiro?.total ??
          data?.resumo_financeiro?.total_a_pagar ??
          repasse + cashback
      ) || (repasse + cashback);

    // se vier tudo zerado, ainda assim aceita (não dá pra inferir mais aqui)
    return { repasse, cashback, total };
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
  const mes_ref = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes_ref) {
    return NextResponse.json({ error: "Informe mes_ref no formato YYYY-MM-01" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const mesAnterior = prevMonthISO(mes_ref);

  // 1) auditorias do mês
  const { data: auds, error: audErr } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref,status")
    .eq("mes_ref", mes_ref);

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  // só entra no relatório se estiver em conferência ou final (fechada pro financeiro)
  const auditorias = (auds ?? []).filter((a: any) => {
    const st = normalizeStatus(a?.status);
    return st === "em_conferencia" || st === "final";
  });

  const condIds = Array.from(new Set(auditorias.map((a: any) => a.condominio_id).filter(Boolean)));

  // 2) condomínios (pega tudo pra não quebrar por coluna inexistente)
  const { data: condos, error: condoErr } = condIds.length
    ? await admin.from("condominios").select("*").in("id", condIds)
    : { data: [], error: null as any };

  if (condoErr) return NextResponse.json({ error: condoErr.message }, { status: 400 });

  const condoMap = new Map((condos ?? []).map((c: any) => [c.id, c]));

  // 3) auditorias do mês anterior (pra variação)
  const { data: audPrev } = await admin
    .from("auditorias")
    .select("id,condominio_id,mes_ref,status")
    .eq("mes_ref", mesAnterior);

  const prevByCondo = new Map<string, any>();
  (audPrev ?? []).forEach((a: any) => prevByCondo.set(a.condominio_id, a));

  // 4) calcular linhas
  const origin = new URL(req.url).origin;
  const cookieHeader = req.headers.get("cookie") ?? "";

  const resultado: any[] = [];

  for (const aud of auditorias) {
    const cond = condoMap.get(aud.condominio_id) ?? null;

    const tot = await fetchTotaisFinanceiros(origin, aud.id, cookieHeader);
    if (!tot) continue;

    let totalAnterior: number | null = null;
    const prev = prevByCondo.get(aud.condominio_id);
    if (prev) {
      const totPrev = await fetchTotaisFinanceiros(origin, prev.id, cookieHeader);
      if (totPrev) totalAnterior = Number(totPrev.total ?? 0) || 0;
    }

    resultado.push({
      condominio: cond?.nome ?? aud.condominio_id,
      pagamento_texto: buildPagamentoString(cond),
      repasse: Number(tot.repasse ?? 0) || 0,
      cashback: Number(tot.cashback ?? 0) || 0,
      total: Number(tot.total ?? 0) || 0,
      variacao_percent: pctChange(Number(tot.total ?? 0) || 0, totalAnterior),
    });
  }

  // ordena por nome do condomínio
  resultado.sort((a, b) => String(a.condominio ?? "").localeCompare(String(b.condominio ?? "")));

  return NextResponse.json({ mes_ref, data: resultado });
}
