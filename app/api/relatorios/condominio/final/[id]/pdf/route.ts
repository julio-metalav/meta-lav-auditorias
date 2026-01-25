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
 * Extrai um UUID de dentro de qualquer string (remove lixo: espaços, <>, aspas, etc.)
 */
function extractUuid(v: any) {
  let s = String(v ?? "").trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // ignore
  }
  s = s.trim();
  s = s.replace(/^\\+/, "");
  s = s.replace(/^["']+/, "").replace(/["']+$/, "");
  s = s.replace(/^<+/, "").replace(/>+$/, "");
  s = s.trim();

  const m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : "";
}

type AnexoPdf = { tipo: string; src?: string; isImagem: boolean };

async function fetchImage(url: string, forwardHeaders?: Record<string, string>) {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      ...(forwardHeaders ?? {}),
    },
  });

  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem: ${res.status} (${ct})`);
  }

  const ctL = ct.toLowerCase();
  const ok =
    ctL.startsWith("image/") ||
    ctL.includes("application/octet-stream") ||
    ctL.includes("binary/octet-stream");

  if (!ok) {
    throw new Error(`Resposta não é imagem (content-type: ${ct})`);
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return { buf, contentType: ct };
}

/**
 * Normalização "definitiva" para react-pdf:
 * -> SEMPRE gerar JPG baseline RGB (mais compatível).
 */
async function normalizeForPdf(url: string, forwardHeaders?: Record<string, string>): Promise<Buffer> {
  const { buf } = await fetchImage(url, forwardHeaders);

  const outJpg = await sharp(buf, { failOnError: false })
    .rotate()
    .toColorspace("rgb")
    .jpeg({
      quality: 85,
      mozjpeg: true,
      progressive: false, // baseline
      chromaSubsampling: "4:2:0",
    })
    .toBuffer();

  return outJpg;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = extractUuid(params.id);
    if (!auditoriaId) return bad("ID inválido");

    const urlObj = new URL(req.url);
    const diag = urlObj.searchParams.get("diag") === "1";

    const origin = getOriginFromRequest(req);

    const cookie = req.headers.get("cookie") || "";
    const authorization = req.headers.get("authorization") || "";

    const forwardHeaders: Record<string, string> = {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    };

    // 1) pega o JSON do relatório final
    const dataRes = await fetch(
      `${origin}/api/relatorios/condominio/final/${encodeURIComponent(auditoriaId)}`,
      {
        headers: {
          Accept: "application/json",
          ...forwardHeaders,
        },
        cache: "no-store",
      }
    );

    const dataJson = await dataRes.json().catch(() => null);
    if (!dataRes.ok) return bad(dataJson?.error ?? "Falha ao obter relatório", 500);

    const payload = dataJson?.data;
    if (!payload) return bad("Relatório sem dados", 500);

    const anexosUrls = payload?.anexos ?? {};

    // 2) ordem correta: Água, Energia, Gás (se houver), Comprovante
    const lista: Array<{ tipo: string; url: string }> = [];
    if (anexosUrls?.foto_agua_url) lista.push({ tipo: "Foto do medidor de Água", url: anexosUrls.foto_agua_url });
    if (anexosUrls?.foto_energia_url) lista.push({ tipo: "Foto do medidor de Energia", url: anexosUrls.foto_energia_url });
    if (anexosUrls?.foto_gas_url) lista.push({ tipo: "Foto do medidor de Gás", url: anexosUrls.foto_gas_url });
    if (anexosUrls?.comprovante_fechamento_url) lista.push({ tipo: "Comprovante de pagamento", url: anexosUrls.comprovante_fechamento_url });

    // 3) baixa/embute (com diagnóstico opcional)
    const diagRows: any[] = [];

    const anexosPdf: AnexoPdf[] = await Promise.all(
      lista.map(async (it) => {
        try {
          const buf = await normalizeForPdf(it.url, forwardHeaders);
          const base64 = buf.toString("base64");
          const src = `data:image/jpeg;base64,${base64}`;

          if (diag) {
            diagRows.push({
              tipo: it.tipo,
              ok: true,
              bytes: buf.length,
              src_prefix: src.slice(0, 30),
            });
          }

          return { tipo: it.tipo, src, isImagem: true };
        } catch (e: any) {
          const msg = e?.message ?? String(e);

          if (diag) {
            diagRows.push({
              tipo: it.tipo,
              ok: false,
              error: msg,
              url: it.url,
            });
          } else {
            console.error(`[pdf] falha anexo "${it.tipo}":`, msg);
          }

          return { tipo: it.tipo, isImagem: false };
        }
      })
    );

    // 🔎 modo diagnóstico: não gera PDF, devolve JSON com o que falhou
    if (diag) {
      // ordena igual a lista
      diagRows.sort((a, b) => {
        const ai = lista.findIndex((x) => x.tipo === a.tipo);
        const bi = lista.findIndex((x) => x.tipo === b.tipo);
        return ai - bi;
      });

      return NextResponse.json(
        {
          auditoriaId,
          anexos_count: lista.length,
          anexos_diag: diagRows,
        },
        { status: 200 }
      );
    }

    // 4) props do PDF
    const props = {
      logo: null,
      condominio: { nome: payload?.meta?.condominio_nome || "—" },
      periodo: payload?.meta?.competencia || "—",
      gerado_em: payload?.meta?.gerado_em || new Date().toISOString(),

      vendas: (payload?.vendas_por_maquina?.itens ?? []).map((v: any) => ({
        maquina: v.maquina,
        ciclos: Number(v.ciclos) || 0,
        valor_unitario: Number(v.valor_unitario) || 0,
        valor_total: Number(v.valor_total) || 0,
      })),

      kpis: {
        receita_bruta: Number(payload?.vendas_por_maquina?.receita_bruta_total) || 0,
        cashback_percentual: Number(payload?.vendas_por_maquina?.cashback_percent) || 0,
        cashback_valor: Number(payload?.vendas_por_maquina?.valor_cashback) || 0,
      },

      consumos: (payload?.consumo_insumos?.itens ?? []).map((c: any) => ({
        nome: c.insumo,
        anterior: c.leitura_anterior ?? null,
        atual: c.leitura_atual ?? null,
        consumo: Number(c.consumo) || 0,
        valor_total: Number(c.valor_total) || 0,
      })),

      total_consumo: Number(payload?.consumo_insumos?.total_repasse_consumo) || 0,
      total_cashback: Number(payload?.totalizacao_final?.cashback) || 0,
      total_pagar: Number(payload?.totalizacao_final?.total_a_pagar_condominio) || 0,

      observacoes: payload?.observacoes || "",
      anexos: anexosPdf,
    };

    const element = React.createElement(RelatorioFinalPdf as any, props as any);
    const pdfBuffer = await renderToBuffer(element);

    const fileName = `relatorio-final-${auditoriaId}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e: any) {
    console.error("[pdf] erro geral:", e?.message ?? e);
    return bad(e?.message ?? "Erro inesperado ao gerar PDF", 500);
  }
}
