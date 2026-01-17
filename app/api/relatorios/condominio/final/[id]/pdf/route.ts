export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { pdf } from "@react-pdf/renderer";

import { getUserAndRole, roleGte } from "@/lib/auth";
import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeText(v: any) {
  return String(v ?? "");
}

function safeNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Faz download da imagem e converte para data URI.
 * Se falhar (timeout, 403, tamanho, etc), retorna null (NÃO derruba o PDF).
 */
async function fetchImageAsDataUri(url: string, timeoutMs = 12000): Promise<string | null> {
  const u = safeText(url).trim();
  if (!u) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(u, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "meta-lav-auditorias-pdf" },
    });

    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const mime =
      ct.includes("png") ? "image/png" :
      ct.includes("jpeg") || ct.includes("jpg") ? "image/jpeg" :
      ct.includes("webp") ? "image/webp" :
      ct.includes("gif") ? "image/gif" :
      "image/png";

    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");

    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Busca o JSON do relatório final usando o mesmo host.
 * Repassa cookie para manter a sessão.
 */
async function fetchReportJson(req: NextRequest, auditoriaId: string) {
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;

  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(`${origin}/api/relatorios/condominio/final/${auditoriaId}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error ? safeText(json.error) : "Falha ao obter dados do relatório.";
    throw new Error(msg);
  }

  return json?.data ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = safeText(params?.id);
  if (!auditoriaId) return bad("ID inválido", 400);

  try {
    const data = await fetchReportJson(req, auditoriaId);
    if (!data) return bad("Relatório sem dados", 404);

    const condominioNome = safeText(data?.meta?.condominio_nome);
    const periodo = safeText(data?.meta?.competencia);

    const vendas = Array.isArray(data?.vendas_por_maquina?.itens)
      ? data.vendas_por_maquina.itens.map((v: any) => ({
          maquina: safeText(v?.maquina),
          ciclos: safeNumber(v?.ciclos),
          valor_unitario: safeNumber(v?.valor_unitario),
          valor_total: safeNumber(v?.valor_total),
        }))
      : [];

    const kpis = {
      receita_bruta: safeNumber(data?.vendas_por_maquina?.receita_bruta_total),
      cashback_percentual: safeNumber(data?.vendas_por_maquina?.cashback_percent),
      cashback_valor: safeNumber(data?.vendas_por_maquina?.valor_cashback),
    };

    const consumos = Array.isArray(data?.consumo_insumos?.itens)
      ? data.consumo_insumos.itens.map((c: any) => ({
          nome: safeText(c?.insumo),
          anterior: safeNumber(c?.leitura_anterior),
          atual: safeNumber(c?.leitura_atual),
          consumo: safeNumber(c?.consumo),
          valor_unitario: safeNumber(c?.valor_unitario),
          valor_total: safeNumber(c?.valor_total),
        }))
      : [];

    const total_consumo = safeNumber(data?.consumo_insumos?.total_repasse_consumo);
    const total_cashback = safeNumber(data?.totalizacao_final?.cashback);
    const total_pagar = safeNumber(data?.totalizacao_final?.total_a_pagar_condominio);

    const obs = safeText(data?.observacoes || "");
    const observacoes = obs.trim() ? obs : undefined;

    const anexosRaw = data?.anexos || {};
    const candidates: Array<{ tipo: string; url: string }> = [
      { tipo: "Foto do medidor de Água", url: safeText(anexosRaw?.foto_agua_url) },
      { tipo: "Foto do medidor de Energia", url: safeText(anexosRaw?.foto_energia_url) },
      { tipo: "Foto do medidor de Gás", url: safeText(anexosRaw?.foto_gas_url) },
      { tipo: "Comprovante de pagamento", url: safeText(anexosRaw?.comprovante_fechamento_url) },
    ].filter((x) => x.url);

    const anexos: Array<{ tipo: string; url?: string; isImagem: boolean }> = [];
    for (const c of candidates) {
      const dataUri = await fetchImageAsDataUri(c.url);
      if (dataUri) anexos.push({ tipo: c.tipo, url: dataUri, isImagem: true });
      else anexos.push({ tipo: c.tipo, isImagem: false });
    }

    // ✅ Importante: tipagem do pdf() é exigente. Cast aqui evita quebra no build.
    const doc = React.createElement(RelatorioFinalPdf as any, {
      condominio: { nome: condominioNome },
      periodo,
      vendas,
      kpis,
      consumos,
      total_consumo,
      total_cashback,
      total_pagar,
      observacoes,
      anexos,
    }) as unknown as React.ReactElement;

    const out = await (pdf as any)(doc).toBuffer();

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="relatorio-final-${auditoriaId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad(e?.message ? safeText(e.message) : "Erro ao gerar PDF", 500);
  }
}
