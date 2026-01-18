export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import React from "react";
import { NextResponse } from "next/server";
import { pdf } from "@react-pdf/renderer";

import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";
import { getUserAndRole, roleGte } from "@/lib/auth";

/**
 * PDF final do relatório do condomínio
 *
 * Regras:
 * - route.ts NÃO usa JSX
 * - usamos React.createElement
 * - no Node/Vercel, prefira toBuffer() (toBlob() costuma dar dor de cabeça)
 * - seu endpoint geralmente retorna { ok: true, data: {...} } => passamos apenas o .data
 */

type Role = "auditor" | "interno" | "gestor";

function safeText(v: any) {
  return String(v ?? "");
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!roleGte(role as Role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const auditoriaId = safeText(params?.id).trim();
  if (!auditoriaId) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  // Busca o JSON consolidado do relatório final
  const baseUrl = new URL(req.url).origin;
  const jsonUrl = `${baseUrl}/api/relatorios/condominio/final/${auditoriaId}`;

  const jsonResp = await fetch(jsonUrl, {
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") ?? "",
      Accept: "application/json",
    },
  });

  const json = await jsonResp.json().catch(() => null);

  if (!jsonResp.ok) {
    const msg =
      json?.error ??
      `Erro ao buscar dados do relatório (HTTP ${jsonResp.status}).`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Seu endpoint costuma responder { ok: true, data: {...} }
  // Se não vier assim, usamos o json bruto como fallback.
  const payload = json?.data ?? json;
  if (!payload) {
    return NextResponse.json({ error: "Relatório sem dados" }, { status: 404 });
  }

  // Geração do PDF (SEM JSX)
  const doc = React.createElement(RelatorioFinalPdf as any, payload) as React.ReactElement;

  // No Node: usar toBuffer()
  const out: Buffer = await (pdf as any)(doc).toBuffer();

  return new NextResponse(out, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-condominio-${auditoriaId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
