export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import React from "react";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";
import { renderToBuffer } from "@react-pdf/renderer";

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

// ✅ remove aspas/escape que podem vir no params.id
function cleanUuidLike(v: any) {
  let s = String(v ?? "").trim();
  s = s.replace(/^"+/, "").replace(/"+$/, "");
  s = s.replace(/^\\"+/, "").replace(/\\"+$/, "");
  s = s.replace(/^["']+/, "").replace(/["']+$/, "");
  return s;
}

function guessFormat(url: string, contentType?: string | null): "jpg" | "png" {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";

  const u = url.toLowerCase();
  if (u.includes(".png")) return "png";
  return "jpg";
}

// ✅ normaliza URL (se vier relativa)
function toAbsUrl(origin: string, url: string) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("/")) return `${origin}${u}`;
  return `${origin}/${u}`;
}

function isSameOriginUrl(origin: string, url: string) {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    return u.origin === o.origin;
  } catch {
    return false;
  }
}

/**
 * Baixa imagem e retorna Buffer + formato.
 * Regra de negócio: aceita só JPG/JPEG.
 * Se não for imagem ou for PNG, lança erro (anexo não entra embutido).
 */
async function fetchImageAsBuffer(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { cache: "no-store", headers: headers ?? {} });

  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem: ${res.status}`);
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // precisa ser imagem
  if (!ct.includes("image/")) {
    throw new Error(`Conteúdo não é imagem (content-type: ${ct || "vazio"})`);
  }

  const fmt = guessFormat(url, ct);

  // regra: só JPG/JPEG
  if (fmt !== "jpg") {
    throw new Error(`Formato não permitido (apenas JPG/JPEG). Detectado: ${fmt}`);
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  return { data: buf, format: "jpg" as const };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = cleanUuidLike(params.id);
  if (!auditoriaId) return bad("ID inválido");

  const origin = getOriginFromRequest(req);

  // mantém sessão do usuário (para chamadas na mesma origem)
  const cookie = req.headers.get("cookie") || "";
  const authorization = req.headers.get("authorization") || "";

  // 1) pega o JSON do relatório final
  const dataRes = await fetch(`${origin}/api/relatorios/condominio/final/${encodeURIComponent(auditoriaId)}`, {
    headers: {
      Accept: "application/json",
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    cache: "no-store",
  });

  const dataJson = await dataRes.json().catch(() => null);
  if (!dataRes.ok) return bad(dataJson?.error ?? "Falha ao obter relatório", 500);

  const payload = dataJson?.data;
  if (!payload) return bad("Relatório sem dados", 500);

  const anexosUrls = payload?.anexos ?? {};

  // 2) monta lista (ordem correta) só com o que existe
  // ✅ ordem final: água, energia, gás (se houver), comprovante
  const lista: Array<{ tipo: string; url: string }> = [];

  if (anexosUrls?.foto_agua_url) lista.push({ tipo: "Foto do medidor de Água", url: anexosUrls.foto_agua_url });
  if (anexosUrls?.foto_energia_url) lista.push({ tipo: "Foto do medidor de Energia", url: anexosUrls.foto_energia_url });
  if (anexosUrls?.foto_gas_url) lista.push({ tipo: "Foto do medidor de Gás", url: anexosUrls.foto_gas_url });

  if (anexosUrls?.comprovante_fechamento_url) {
    lista.push({ tipo: "Comprovante de pagamento", url: anexosUrls.comprovante_fechamento_url });
  }

  // 3) baixa e embute (se falhar algum, não quebra tudo: não embute)
  const anexosPdf = await Promise.all(
    lista.map(async (it) => {
      const absUrl = toAbsUrl(origin, it.url);

      // só repassa sessão se a URL for da própria aplicação (mesma origem)
      const extraHeaders: Record<string, string> = {};
      if (isSameOriginUrl(origin, absUrl)) {
        if (cookie) extraHeaders.cookie = cookie;
        if (authorization) extraHeaders.authorization = authorization;
      }

      try {
        const src = await fetchImageAsBuffer(absUrl, Object.keys(extraHeaders).length ? extraHeaders : undefined);
        return { tipo: it.tipo, src, isImagem: true };
      } catch {
        // não embute — PDF fica só com o título (sem placeholder grande)
        return { tipo: it.tipo, isImagem: false as const };
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
}
