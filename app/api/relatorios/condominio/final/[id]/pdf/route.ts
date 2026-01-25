export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import React from "react";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/auth";

import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanUuidLike(v: any) {
  let s = String(v ?? "").trim();
  s = s.replace(/^"+/, "").replace(/"+$/, "");
  s = s.replace(/^\\"+/, "").replace(/\\"+$/, "");
  s = s.replace(/^["']+/, "").replace(/["']+$/, "");
  return s;
}

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

function guessFormat(path: string): "jpg" | "png" {
  return path.toLowerCase().endsWith(".png") ? "png" : "jpg";
}

async function loadFromStorage(path: string): Promise<ImageSrcObj> {
  const admin = supabaseAdmin();

  const cleanPath = path.replace(/^\/?storage\/v1\/object\/(public|sign)\//, "");

  const { data, error } = await admin.storage.from("auditorias").download(cleanPath);
  if (error || !data) throw error ?? new Error("Falha ao baixar arquivo");

  const buf = Buffer.from(await data.arrayBuffer());
  const fmt = guessFormat(cleanPath);

  if (fmt === "png") {
    return { data: buf, format: "png" };
  }

  try {
    const out = await sharp(buf, { failOnError: false })
      .rotate()
      .jpeg({ quality: 85, mozjpeg: true, progressive: false })
      .toBuffer();
    return { data: out, format: "jpg" };
  } catch {
    return { data: buf, format: "jpg" };
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = cleanUuidLike(params.id);
    if (!auditoriaId) return bad("ID inválido");

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";
    const authorization = req.headers.get("authorization") || "";

    const dataRes = await fetch(
      `${origin}/api/relatorios/condominio/final/${encodeURIComponent(auditoriaId)}`,
      {
        headers: {
          Accept: "application/json",
          ...(cookie ? { cookie } : {}),
          ...(authorization ? { authorization } : {}),
        },
        cache: "no-store",
      }
    );

    const dataJson = await dataRes.json().catch(() => null);
    if (!dataRes.ok) return bad(dataJson?.error ?? "Falha ao obter relatório", 500);

    const payload = dataJson?.data;
    if (!payload) return bad("Relatório sem dados", 500);

    const anexosUrls = payload?.anexos ?? {};

    const lista: Array<{ tipo: string; path: string }> = [];
    if (anexosUrls?.foto_agua_url) lista.push({ tipo: "Foto do medidor de Água", path: anexosUrls.foto_agua_url });
    if (anexosUrls?.foto_energia_url) lista.push({ tipo: "Foto do medidor de Energia", path: anexosUrls.foto_energia_url });
    if (anexosUrls?.foto_gas_url) lista.push({ tipo: "Foto do medidor de Gás", path: anexosUrls.foto_gas_url });
    if (anexosUrls?.comprovante_fechamento_url)
      lista.push({ tipo: "Comprovante de pagamento", path: anexosUrls.comprovante_fechamento_url });

    const anexosPdf: AnexoPdf[] = await Promise.all(
      lista.map(async (it) => {
        try {
          const src = await loadFromStorage(it.path);
          return { tipo: it.tipo, src, isImagem: true };
        } catch {
          return { tipo: it.tipo, isImagem: false };
        }
      })
    );

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
    const pdfBuffer = await (renderToBuffer as any)(element);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="relatorio-final-${auditoriaId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado ao gerar PDF", 500);
  }
}
