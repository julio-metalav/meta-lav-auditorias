export const runtime = "nodejs";

import React from "react";
import { pdf } from "@react-pdf/renderer";
import { RelatorioFinalPdf } from "@/app/relatorios/condominio/final/[id]/RelatorioFinalPdf";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}/api/relatorios/condominio/final/${params.id}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) return Response.json(json ?? { error: "Falha ao obter dados" }, { status: res.status });

  const doc = React.createElement(RelatorioFinalPdf as any, { data: json.data });

  // ✅ web-safe: Blob -> ArrayBuffer -> Uint8Array
  const blob = await pdf(doc as any).toBlob();
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-${params.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
