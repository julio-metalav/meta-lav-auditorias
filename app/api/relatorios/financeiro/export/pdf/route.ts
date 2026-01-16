export const runtime = "nodejs";

import PDFDocument from "pdfkit";
import { getUserAndRole } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function brl(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "R$ 0,00";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2).replace(".", ",")}%`;
}

// PDFKit (Node stream) -> ReadableStream (Web)
function pdfkitToReadableStream(doc: any) {
  return new ReadableStream({
    start(controller) {
      doc.on("data", (chunk: any) => {
        const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        controller.enqueue(u8);
      });
      doc.on("end", () => controller.close());
      doc.on("error", (err: any) => controller.error(err));
      doc.end();
    },
    cancel() {
      try {
        doc.destroy();
      } catch {}
    },
  });
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno")) {
    return Response.json({ error: "Sem permissão" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mes_ref = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes_ref) return Response.json({ error: "Informe mes_ref=YYYY-MM-01" }, { status: 400 });

  const origin = new URL(req.url).origin;
  const relRes = await fetch(`${origin}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  if (!relRes.ok) {
    const j = await relRes.json().catch(() => ({}));
    return Response.json({ error: (j as any)?.error ?? "Falha ao gerar relatório" }, { status: 400 });
  }

  const relJson: any = await relRes.json();
  const rows = Array.isArray(relJson?.data) ? relJson.data : [];

  const doc = new PDFDocument({ size: "A4", margin: 36 });

  doc.fontSize(16).text(`Relatório Financeiro - ${mes_ref}`, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#333").text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  doc.moveDown(1);

  for (const r of rows) {
    doc.fillColor("#000").fontSize(12).text(String(r?.condominio ?? "Condomínio"));
    doc.fillColor("#444").fontSize(9).text(String(r?.pagamento_texto ?? ""));

    doc.fillColor("#000").fontSize(10).text(
      `Repasse: ${brl(r?.repasse)}   |   Cashback: ${brl(r?.cashback)}   |   Total: ${brl(r?.total)}`
    );

    doc.fontSize(10).text(`Variação vs mês anterior: ${pct(r?.variacao_percent)}`);

    doc.moveDown(0.8);
    doc.moveTo(doc.x, doc.y).lineTo(559, doc.y).strokeColor("#e5e5e5").stroke();
    doc.moveDown(0.8);

    if (doc.y > 740) doc.addPage();
  }

  const stream = pdfkitToReadableStream(doc);
  const filename = `relatorio_financeiro_${mes_ref}.pdf`;

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
