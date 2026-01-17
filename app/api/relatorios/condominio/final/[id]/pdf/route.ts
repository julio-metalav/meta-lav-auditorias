export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { pdf } from "@react-pdf/renderer";
import fs from "node:fs/promises";
import path from "node:path";

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

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

async function fetchImageAsBuffer(url: string, timeoutMs = 20000): Promise<ImageSrcObj | null> {
  const u = safeText(url).trim();
  if (!u) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(u, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const format: "png" | "jpg" = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "png";

    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);

    // evita PDF gigante
    if (buf.length > 10 * 1024 * 1024) return null;

    return { data: buf, format };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function getOrigin(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

async function fetchReportJson(req: NextRequest, origin: string, auditoriaId: string) {
  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(`${origin}/api/relatorios/condominio/final/${auditoriaId}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", cookie },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error ? safeText(json.error) : "Falha ao obter dados do relatório.";
    throw new Error(msg);
  }
  return json?.data ?? null;
}

// ✅ SOLUÇÃO DEFINITIVA: lê do /public, sem HTTP, sem host, sem Vercel doida.
async function fetchLogoFromPublic(): Promise<ImageSrcObj | null> {
  const candidates = ["logo.png", "logo.jpg", "logo.jpeg", "logo Meta Lav.jpg", "logo Meta Lav.png"];

  for (const name of candidates) {
    try {
      const p = path.join(process.cwd(), "public", name);
      const buf = await fs.readFile(p);
      if (!buf || buf.length === 0) continue;

      const lower = name.toLowerCase();
      const format: "png" | "jpg" =
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "jpg" : "png";

      return { data: buf, format };
    } catch {
      // tenta o próximo
    }
  }

  console.error("LOGO NAO ENCONTRADA em /public (tente deixar apenas public/logo.png)");
  return null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = safeText(params?.id).trim();
  if (!auditoriaId) return bad("ID inválido", 400);

  const origin = getOrigin(req);

  try {
    const data = await fetchReportJson(req, origin, auditoriaId);
    if (!data) return bad("Relatório sem dados", 404);

    const condominioNome = safeText(data?.meta?.condominio_nome);
    const periodo = safeText(data?.meta?.competencia);
    const geradoEm = safeText(data?.meta?.gerado_em || "");

    // 1) Vendas
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

    // 2) Insumos (com anterior/atual/consumo/repasse)
    const consumos = Array.isArray(data?.consumo_insumos?.itens)
      ? data.consumo_insumos.itens.map((c: any) => ({
          nome: safeText(c?.insumo),
          anterior: c?.leitura_anterior ?? null,
          atual: c?.leitura_atual ?? null,
          consumo: safeNumber(c?.consumo),
          valor_total: safeNumber(c?.valor_total),
        }))
      : [];

    const total_consumo = safeNumber(data?.consumo_insumos?.total_repasse_consumo);

    // 3) Financeiro
    const total_cashback = safeNumber(data?.totalizacao_final?.cashback);
    const total_pagar = safeNumber(data?.totalizacao_final?.total_a_pagar_condominio);

    // 4) Observações
    const observacoes = safeText(data?.observacoes || "").trim();

    // Logo
    const logo = await fetchLogoFromPublic();

    // Anexos
    const anexosRaw = data?.anexos || {};
    const candidates: Array<{ tipo: string; url: string }> = [
      { tipo: "Foto do medidor de Água", url: safeText(anexosRaw?.foto_agua_url) },
      { tipo: "Foto do medidor de Energia", url: safeText(anexosRaw?.foto_energia_url) },
      { tipo: "Foto do medidor de Gás", url: safeText(anexosRaw?.foto_gas_url) },
      { tipo: "Comprovante de pagamento", url: safeText(anexosRaw?.comprovante_fechamento_url) },
    ].filter((x) => x.url);

    const anexos: AnexoPdf[] = [];
    for (const c of candidates) {
      const src = await fetchImageAsBuffer(c.url);
      if (src) anexos.push({ tipo: c.tipo, src, isImagem: true });
      else anexos.push({ tipo: c.tipo, isImagem: false });
    }

    const doc = React.createElement(RelatorioFinalPdf as any, {
      logo,
      condominio: { nome: condominioNome },
      periodo,
      gerado_em: geradoEm,
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
