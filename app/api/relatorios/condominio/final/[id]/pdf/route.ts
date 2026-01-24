export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";
import { getUserAndRole, roleGte } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";
type ImgFormat = "png" | "jpg";

type ImageSrcObj = { data: Buffer; format: ImgFormat };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

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

function detectFormat(url: string, contentType?: string | null): ImgFormat | null {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpg";

  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "jpg";
  return null;
}

async function fetchImageAsBuffer(url: string): Promise<ImageSrcObj | null> {
  if (!url) return null;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const ct = res.headers.get("content-type");
  const format = detectFormat(url, ct);
  if (!format) return null; // se vier PDF etc, ignora (do jeito que você quer)

  const ab = await res.arrayBuffer();
  return { data: Buffer.from(ab), format };
}

type ReportDTO = {
  meta: { auditoria_id: string; condominio_nome: string; competencia: string; gerado_em: string };
  vendas_por_maquina: {
    itens: Array<{ maquina: string; ciclos: number; valor_unitario: number; valor_total: number }>;
    receita_bruta_total: number;
    cashback_percent: number;
    valor_cashback: number;
  };
  consumo_insumos: {
    itens: Array<{ insumo: string; leitura_anterior: number | null; leitura_atual: number | null; consumo: number; valor_total: number }>;
    total_repasse_consumo: number;
  };
  totalizacao_final: { cashback: number; repasse_consumo: number; total_a_pagar_condominio: number };
  observacoes: string | null;
  anexos: {
    foto_agua_url?: string | null;
    foto_energia_url?: string | null;
    foto_gas_url?: string | null;
    comprovante_fechamento_url?: string | null;
  };
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = String(params.id || "").trim();
  if (!auditoriaId) return bad("ID inválido", 400);

  const origin = getOriginFromRequest(req);
  const cookie = req.headers.get("cookie") || "";
  const authorization = req.headers.get("authorization") || "";

  // 1) pega o JSON do relatório (teu endpoint existente)
  const dtoRes = await fetch(`${origin}/api/relatorios/condominio/final/${auditoriaId}`, {
    headers: {
      Accept: "application/json",
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    cache: "no-store",
  });

  const dtoJson = await dtoRes.json().catch(() => null);
  if (!dtoRes.ok) return bad(dtoJson?.error ?? "Falha ao obter dados do relatório", 500);

  const data: ReportDTO = dtoJson?.data ?? null;
  if (!data) return bad("Sem dados do relatório", 500);

  // 2) monta anexos (ORDEM IMPORTANTE: Água, Energia, Comprovante, Gás)
  const a = data.anexos || {};

  const anexosOrdem: Array<{ tipo: string; url?: string | null }> = [
    { tipo: "Foto do medidor de Água", url: a.foto_agua_url },
    { tipo: "Foto do medidor de Energia", url: a.foto_energia_url },
    { tipo: "Comprovante de pagamento", url: a.comprovante_fechamento_url },
    { tipo: "Foto do medidor de Gás", url: a.foto_gas_url },
  ];

  const anexos: AnexoPdf[] = [];
  for (const it of anexosOrdem) {
    if (!it.url) continue;

    const img = await fetchImageAsBuffer(it.url);
    if (!img) {
      // mantém o card no PDF com msg "Não foi possível incorporar..." (se você quiser)
      anexos.push({ tipo: it.tipo, isImagem: true, src: undefined });
      continue;
    }

    anexos.push({ tipo: it.tipo, isImagem: true, src: img });
  }

  // 3) monta props pro PDF (bate 1:1 com RelatorioFinalPdf.tsx)
  const props = {
    logo: null as any, // se você já tem logo no PDF antigo, me manda esse trecho que eu encaixo aqui
    condominio: { nome: data.meta.condominio_nome, pagamento_texto: "—" }, // pagamento_texto vem do condo no PDF; se quiser puxar do JSON, me diga onde está
    periodo: data.meta.competencia,
    gerado_em: data.meta.gerado_em,

    vendas: (data.vendas_por_maquina?.itens ?? []).map((x) => ({
      maquina: x.maquina,
      ciclos: Number(x.ciclos) || 0,
      valor_unitario: Number(x.valor_unitario) || 0,
      valor_total: Number(x.valor_total) || 0,
    })),

    kpis: {
      receita_bruta: Number(data.vendas_por_maquina?.receita_bruta_total) || 0,
      cashback_percentual: Number(data.vendas_por_maquina?.cashback_percent) || 0,
      cashback_valor: Number(data.vendas_por_maquina?.valor_cashback) || 0,
    },

    consumos: (data.consumo_insumos?.itens ?? []).map((x) => ({
      nome: x.insumo,
      anterior: x.leitura_anterior ?? null,
      atual: x.leitura_atual ?? null,
      consumo: Number(x.consumo) || 0,
      valor_total: Number(x.valor_total) || 0,
    })),

    total_consumo: Number(data.consumo_insumos?.total_repasse_consumo) || 0,
    total_cashback: Number(data.totalizacao_final?.cashback) || 0,
    total_pagar: Number(data.totalizacao_final?.total_a_pagar_condominio) || 0,

    observacoes: data.observacoes ?? "",
    anexos,
  };

  // 4) gera PDF
  const pdfBuffer = await renderToBuffer(<RelatorioFinalPdf {...(props as any)} />);

  const fileName = `relatorio-final-${auditoriaId}.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
