export const runtime = "nodejs";

import React from "react";
import { NextResponse } from "next/server";
import { pdf } from "@react-pdf/renderer";

import RelatorioFinalPdf from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";
import { getUserAndRole, roleGte } from "@/lib/auth";

/**
 * Geração do PDF final do relatório do condomínio
 *
 * IMPORTANTE:
 * - route.ts NÃO aceita JSX
 * - react-pdf exige ReactElement<DocumentProps>
 * - cast explícito é necessário (limitação de tipagem)
 */

type Role = "auditor" | "interno" | "gestor";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { supabase, user, role } = await getUserAndRole();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!roleGte(role as Role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const auditoriaId = params.id;

  /**
   * Busca o JSON consolidado do relatório final
   */
  const baseUrl = new URL(req.url).origin;
  const jsonUrl = `${baseUrl}/api/relatorios/condominio/final/${auditoriaId}`;

  const jsonResp = await fetch(jsonUrl, {
    headers: {
      cookie: req.headers.get("cookie") ?? "",
    },
  });

  if (!jsonResp.ok) {
    return NextResponse.json(
      { error: "Erro ao buscar dados do relatório" },
      { status: 500 }
    );
  }

  const data = await jsonResp.json();

  /**
   * Geração do PDF
   * - SEM JSX
   * - Cast explícito exigido pelo react-pdf
   */
  const doc = React.createElement(
    RelatorioFinalPdf,
    data
  ) as React.ReactElement;

  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-condominio-${auditoriaId}.pdf"`,
    },
  });
}
