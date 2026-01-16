export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthStart(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function prevMonthStart(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const yyyy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function pickAnyTotal(json: any, key: string) {
  return (
    json?.data?.totais?.[key] ??
    json?.data?.[key] ??
    json?.totais?.[key] ??
    json?.[key] ??
    0
  );
}

function buildPagamentoTexto(condo: any) {
  const pix =
    condo?.pix ??
    condo?.pix_chave ??
    condo?.chave_pix ??
    condo?.pix_key ??
    condo?.pixKey ??
    null;

  const doc =
    condo?.cnpj ??
    condo?.cpf ??
    condo?.documento ??
    condo?.doc ??
    condo?.cnpj_cpf ??
    condo?.cpf_cnpj ??
    null;

  if (pix) {
    const docTxt = doc ? ` • CNPJ/CPF: ${doc}` : "";
    return `PIX: ${String(pix)}${docTxt}`;
  }

  const bancoCodigo = condo?.banco_codigo ?? condo?.banco ?? condo?.codigo_banco ?? null;
  const bancoNome = condo?.banco_nome ?? condo?.nome_banco ?? null;

  const agencia = condo?.agencia ?? condo?.agencia_numero ?? null;
  const conta = condo?.conta ?? condo?.conta_numero ?? null;

  const bancoTxt =
    bancoCodigo && bancoNome
      ? `Banco (${bancoCodigo}): ${bancoNome}`
      : bancoCodigo
      ? `Banco (${bancoCodigo})`
      : bancoNome
      ? `Banco: ${bancoNome}`
      : "Banco";

  const agTxt = agencia ? ` • Agência: ${agencia}` : "";
  const ccTxt = conta ? ` • Conta: ${conta}` : "";
  const docTxt = doc ? ` • CNPJ/CPF: ${doc}` : "";

  return `${bancoTxt}${agTxt}${ccTxt}${docTxt}`.trim();
}

function getBaseUrlFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.headers.get(":authority");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function fetchTotaisForAuditoria(baseUrl: string, auditoriaId: string, cookie: string) {
  const headers = cookie ? { cookie } : undefined;

  // 1) tenta /ciclos
  try {
    const r = await fetch(`${baseUrl}/api/auditorias/${auditoriaId}/ciclos`, {
      cache: "no-store",
      headers,
    });
    if (r.ok) {
      const j = await r.json();
      return {
        total_repasse: num(pickAnyTotal(j, "total_repasse")),
        total_cashback: num(pickAnyTotal(j, "total_cashback")),
        total_a_pagar: num(pickAnyTotal(j, "total_a_pagar")),
        receita_bruta: num(pickAnyTotal(j, "receita_bruta")),
      };
    }
  } catch {}

  // 2) fallback: /auditorias/[id]
  try {
    const r = await fetch(`${baseUrl}/api/auditorias/${auditoriaId}`, {
      cache: "no-store",
      headers,
    });
    if (r.ok) {
      const j = await r.json();
      return {
        total_repasse: num(pickAnyTotal(j, "total_repasse")),
        total_cashback: num(pickAnyTotal(j, "total_cashback")),
        total_a_pagar: num(pickAnyTotal(j, "total_a_pagar")),
        receita_bruta: num(pickAnyTotal(j, "receita_bruta")),
      };
    }
  } catch {}

  return { total_repasse: 0, total_cashback: 0, total_a_pagar: 0, receita_bruta: 0 };
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref_raw = url.searchParams.get("mes_ref") || "";
    const mes_ref = monthStart(mes_ref_raw);
    if (!mes_ref) return bad("Parâmetro mes_ref inválido (use YYYY-MM-01)", 400);

    const mes_prev = prevMonthStart(mes_ref);

    const baseUrl = getBaseUrlFromReq(req);
    if (!baseUrl) return bad("Não foi possível determinar baseUrl", 500);

    // ✅ ESSENCIAL: repassa sessão para chamadas internas
    const cookie = req.headers.get("cookie") || "";

    // ✅ Busca auditorias do mês (schema real: mes_ref)
    const { data: auds, error: audErr } = await supabaseAdmin()
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("mes_ref", mes_ref)
      .in("status", ["em_conferencia", "final"]);

    if (audErr) return bad(audErr.message, 500);

    if (!auds || auds.length === 0) {
      return NextResponse.json({ ok: true, mes_ref, rows: [] });
    }

    const condIds = Array.from(new Set(auds.map((a: any) => a.condominio_id).filter(Boolean)));

    const { data: condominios, error: condoErr } = await supabaseAdmin()
      .from("condominios")
      .select("*")
      .in("id", condIds);

    if (condoErr) return bad(condoErr.message, 500);

    const condoById = new Map<string, any>((condominios ?? []).map((c: any) => [c.id, c]));

    // ✅ totais do mês anterior (variação)
    let prevByCondo = new Map<string, number>();
    if (mes_prev) {
      const { data: prevAuds, error: prevErr } = await supabaseAdmin()
        .from("auditorias")
        .select("id, condominio_id, mes_ref, status")
        .eq("mes_ref", mes_prev)
        .in("status", ["em_conferencia", "final"]);

      if (!prevErr && prevAuds && prevAuds.length) {
        const totalsPrev = await Promise.all(
          prevAuds.map(async (a: any) => {
            const t = await fetchTotaisForAuditoria(baseUrl, a.id, cookie);
            return { condominio_id: a.condominio_id, total: num(t.total_a_pagar) };
          })
        );

        for (const row of totalsPrev) {
          if (!row.condominio_id) continue;
          prevByCondo.set(String(row.condominio_id), row.total);
        }
      }
    }

    const rows = await Promise.all(
      auds.map(async (a: any) => {
        const condo = condoById.get(String(a.condominio_id)) ?? {};
        const pagamento_texto = buildPagamentoTexto(condo);

        const t = await fetchTotaisForAuditoria(baseUrl, a.id, cookie);

        const repasse = num(t.total_repasse);
        const cashback = num(t.total_cashback);
        const total = num(t.total_a_pagar);

        const prevTotal = prevByCondo.get(String(a.condominio_id)) ?? 0;
        const variacao_percent = prevTotal > 0 ? (total - prevTotal) / prevTotal : 0;

        return {
          condominio_id: String(a.condominio_id),
          condominio_nome: String(condo?.nome ?? "Condomínio"),
          pagamento_texto,
          repasse,
          cashback,
          total,
          variacao_percent,
        };
      })
    );

    return NextResponse.json({ ok: true, mes_ref, rows });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
