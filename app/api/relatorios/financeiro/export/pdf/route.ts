export const runtime = "nodejs";

import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { getUserAndRole } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBaseUrlFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.headers.get(":authority");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

function nodeStreamToWebReadable(nodeStream: NodeJS.ReadableStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      try {
        // @ts-ignore
        nodeStream.destroy?.();
      } catch {}
    },
  });
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = url.searchParams.get("mes_ref") || "";
    if (!mes_ref) return bad("Parâmetro mes_ref obrigatório (YYYY-MM-01)", 400);

    const baseUrl = getBaseUrlFromReq(req);
    if (!baseUrl) return bad("Não foi possível determinar baseUrl", 500);

    const cookie = req.headers.get("cookie") || "";

    // ✅ Fonte da verdade: JSON base
    const r = await fetch(
      `${baseUrl}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`,
      {
        cache: "no-store",
        headers: { cookie },
      }
    );

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return bad(`Falha ao gerar base do relatório (${r.status}). ${t}`, 500);
    }

    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.rows) ? j.rows : [];

    // ✅ PDF simples
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const passthrough = new PassThrough();
    doc.pipe(passthrough);

    doc.fontSize(14).text(`Relatório Financeiro - ${mes_ref}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(10);

    if (!rows.length) {
      doc.text("Sem auditorias em conferência/final para este mês.");
    } else {
      for (const row of rows) {
        doc
          .font("Helvetica-Bold")
          .text(String(row?.condominio_nome ?? "Condomínio"), { continued: false });
        doc.font("Helvetica").text(String(row?.pagamento_texto ?? ""));
        doc.text(`Repasse: R$ ${Number(row?.repasse ?? 0).toFixed(2)}`);
        doc.text(`Cashback: R$ ${Number(row?.cashback ?? 0).toFixed(2)}`);
        doc.text(`Total: R$ ${Number(row?.total ?? 0).toFixed(2)}`);
        doc.text(
          `Variação vs mês anterior: ${(Number(row?.variacao_percent ?? 0) * 100).toFixed(2)}%`
        );
        doc.moveDown();
      }
    }

    doc.end();

    const webStream = nodeStreamToWebReadable(passthrough);

    return new Response(webStream as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio_financeiro_${mes_ref}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
