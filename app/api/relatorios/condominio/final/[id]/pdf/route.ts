export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import React from "react";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";

import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getOriginFromRequest(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  if (host) return `${proto}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost";
  }
}

/**
 * Extrai UUID limpo
 */
function extractUuid(v: any) {
  let s = String(v ?? "").trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  const m = s.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  );
  return m ? m[0] : "";
}

type AnexoPdf = { tipo: string; src?: string; isImagem: boolean };

async function fetchImage(url: string, forwardHeaders?: Record<string, string>) {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      Accept: "image/*,*/*;q=0.8",
      ...(forwardHeaders ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem: ${res.status}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Normalização segura para react-pdf:
 * - NÃO força colorspace
 * - só regrava como JPEG baseline
 */
async function normalizeForPdf(url: string, forwardHeaders?: Record<string, string>): Promise<Buffer> {
  const buf = await fetchImage(url, forwardHeaders);

  return await sharp(buf, { failOnError: false })
    .rotate()
    .jpeg({
      quality: 85,
      mozjpeg: true,
      progressive: false, // baseline
    })
    .toBuffer();
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = extractUuid(params.id);
    if (!auditoriaId) return bad("ID inválido");

    const origin = getOriginFromRequest(req);

    const cookie = req.headers.get("cookie") || "";
    const authorization = req.headers.get("authorization") || "";

    const forwardHeaders: Record<string, string> = {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    };

    const dataRes = await fetch(
      `${origin}/api/relatorios/condominio/final/${auditoriaId}`,
      { headers: { Accept: "application/json", ...forwardHeaders }, cache: "no-store" }
    );

    const dataJson = await dataRes.json();
    if (!dataRes.ok) return bad(dataJson?.error ?? "Erro ao obter relatório", 500);

    const payload = dataJson.data;
    const anexosUrls = payload?.anexos ?? {};

    const lista: Array<{ tipo: string; url: string }> = [];
    if (anexosUrls.foto_agua_url) lista.push({ tipo: "Foto do medidor de Água", url: anexosUrls.foto_agua_url });
    if (anexosUrls.foto_energia_url) lista.push({ tipo: "Foto do medidor de Energia", url: anexosUrls.foto_energia_url });
    if (anexosUrls.foto_gas_url) lista.push({ tipo: "Foto do medidor de Gás", url: anexosUrls.foto_gas_url });
    if (anexosUrls.comprovante_fechamento_url)
      lista.push({ tipo: "Comprovante de pagamento", url: anexosUrls.comprovante_fechamento_url });

    const anexos: AnexoPdf[] = await Promise.all(
      lista.map(async (it) => {
        try {
          const buf = await normalizeForPdf(it.url, forwardHeaders);
          const src = `data:image/jpeg;base64,${buf.toString("base64")}`;
          return { tipo: it.tipo, src, isImagem: true };
        } catch (e: any) {
          console.error(`[pdf] falha anexo "${it.tipo}"`, e?.message);
          return { tipo: it.tipo, isImagem: false };
        }
      })
    );

    const element = React.createElement(RelatorioFinalPdf as any, {
      logo: null,
      condominio: { nome: payload?.meta?.condominio_nome || "—" },
      periodo: payload?.meta?.competencia || "—",
      gerado_em: payload?.meta?.gerado_em || new Date().toISOString(),
      vendas: payload?.vendas_por_maquina?.itens ?? [],
      kpis: payload?.vendas_por_maquina ?? {},
      consumos: payload?.consumo_insumos?.itens ?? [],
      total_consumo: payload?.consumo_insumos?.total_repasse_consumo ?? 0,
      total_cashback: payload?.totalizacao_final?.cashback ?? 0,
      total_pagar: payload?.totalizacao_final?.total_a_pagar_condominio ?? 0,
      observacoes: payload?.observacoes ?? "",
      anexos,
    });

    const pdfBuffer = await renderToBuffer(element);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="relatorio-final-${auditoriaId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[pdf] erro geral", e?.message);
    return bad("Erro ao gerar PDF", 500);
  }
}
