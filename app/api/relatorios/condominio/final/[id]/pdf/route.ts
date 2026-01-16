export const runtime = "nodejs";

import React from "react";
import { NextResponse } from "next/server";
import { pdf } from "@react-pdf/renderer";
import { RelatorioFinalPdf } from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno"))
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}/api/relatorios/condominio/final/${params.id}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json(json ?? { error: "Falha ao obter dados" }, { status: res.status });

  // ✅ Sem JSX em route.ts (evita Syntax Error no build)
  const doc = React.createElement(RelatorioFinalPdf as any, { data: json.data });
  const buffer = await pdf(doc as any).toBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-${params.id}.pdf"`,
    },
  });
}
