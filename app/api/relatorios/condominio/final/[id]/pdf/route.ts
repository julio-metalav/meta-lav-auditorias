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

// remove aspas/escape que podem vir no params.id
function cleanUuidLike(v: any) {
  let s = String(v ?? "").trim();
  s = s.replace(/^"+/, "").replace(/"+$/, "");
  s = s.replace(/^\\"+/, "").replace(/\\"+$/, "");
  s = s.replace(/^["']+/, "").replace(/["']+$/, "");
  return s;
}

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

function guessFormat(url: string, contentType?: string | null): "jpg" | "png" {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const u = url.toLowerCase();
  if (u.includes(".png")) return "png";
  return "jpg";
}

async function fetchImage(url: string, forwardHeaders?: Record<string, string>) {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      // evita alguns CDNs devolverem html
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      ...(forwardHeaders ?? {}),
    },
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    throw new Error(`Falha ao baixar imagem: ${res.status} (${ct})`);
  }

  const ct = res.headers.get("content-type") || "";
  // Se não é imagem, o PDF pode renderizar em branco ou estourar em decode.
  if (!ct.toLowerCase().startsWith("image/")) {
    throw new Error(`Resposta não é imagem (content-type: ${ct})`);
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const fmt = guessFormat(url, ct);
  return { buf, fmt, contentType: ct };
}

/**
 * Normalização "definitiva" para react-pdf:
 * -> SEMPRE gerar JPG baseline RGB (mais compatível).
 * Se falhar, não derruba a rota (caller decide fallback).
 */
async function normalizeForPdf(url: string, forwardHeaders?: Record<string, string>): Promise<ImageSrcObj> {
  const { buf } = await fetchImage(url, forwardHeaders);

  // Sempre converte para JPG baseline RGB
  // (resolve CMYK/progressive/EXIF/HEIC disfarçado em muitos casos quando sharp consegue decodificar)
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

  return { data: outJpg, format: "jpg" };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = cleanUuidLike(params.id);
    if (!auditoriaId) return bad("ID inválido");

    const origin = getOriginFromRequest(req);

    // mantém sessão do usuário
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

    // 3) baixa e embute — sem derrubar a rota se 1 anexo falhar
    const anexosPdf: AnexoPdf[] = await Promise.all(
      lista.map(async (it) => {
        try {
          // importante: reenvia cookie/authorization para Storage privado
          const src = await normalizeForPdf(it.url, forwardHeaders);
          return { tipo: it.tipo, src, isImagem: true };
        } catch (e: any) {
          console.error(`[pdf] falha anexo "${it.tipo}":`, e?.message ?? e);
          // não derruba o PDF
          return { tipo: it.tipo, isImagem: false };
        }
      })
    );

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
