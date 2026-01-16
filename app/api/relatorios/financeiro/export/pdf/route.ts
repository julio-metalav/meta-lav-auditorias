export const runtime = "nodejs";

import { NextResponse } from "next/server";
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

function pagamentoLinha(p: any) {
  if (!p) return "";
  const tipo = String(p.tipo ?? "").toLowerCase();
  if (tipo.includes("pix")) {
    return `PIX: ${p.pix ?? ""} | Titular: ${p.titular ?? ""}`;
  }
  return `Banco: ${p.banco ?? ""} | Ag: ${p.agencia ?? ""} | Cc: ${p.conta ?? ""} | Titular: ${p.titular ?? ""}`;
}

// Converte stream do PDFKit (Node) em ReadableStream (Web) p/ NextResponse
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
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mes_ref = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes_ref) return NextResponse.json({ error: "Informe mes_ref=YYYY-MM-01" }, { status: 400 });

  // chama o JSON base (já logado, repassa cookie)
  const origin = new URL(req.url).origin;
  const relRes = await fetch(`${origin}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  if (!relRes.ok) {
    const j = await relRes.json().catch(() => ({}));
    return NextResponse.json({ error: (j as any)?.error ?? "Falha ao gerar relatório" }, { status: 400 });
  }

  const relJson = await relRes.json();
  const rows = Array.isArray((relJson as any)?.data) ? (relJson as any).data : [];

  // monta PDF
  const doc = new PDFDocument({ size: "A4", margin: 36 });

  doc.fontSize(16).text(`Relatório Financeiro - ${mes_ref}`, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#333").text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  doc.moveDown(1);

  doc.fontSize(11).fillColor("#000");

  for (const r of rows) {
    doc.fontSize(12).text(String(r?.condominio ?? "Condomínio"), { continued: false });
    doc.fontSize(9).fillColor("#444").text(pagamentoLinha(r?.pagamento));
    doc.fillColor("#000");

    doc
      .fontSize(10)
      .text(`Repasse: ${brl(r?.repasse)}   |   Cashback: ${brl(r?.cashback)}   |   Total: ${brl(r?.total)}`);

    const ant = r?.mes_anterior == null ? "—" : brl(r?.mes_anterior);
    doc.fontSize(10).text(`Mês anterior: ${ant}   |   Variação: ${pct(r?.variacao_percent)}`);

    doc.moveDown(0.8);
    doc.moveTo(doc.x, doc.y).lineTo(559, doc.y).strokeColor("#e5e5e5").stroke();
    doc.moveDown(0.8);

    if (doc.y > 740) doc.addPage();
  }

  const stream = pdfkitToReadableStream(doc);
  const filename = `relatorio_financeiro_${mes_ref}.pdf`;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
