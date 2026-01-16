export const runtime = "nodejs";

import { getUserAndRole } from "@/lib/auth";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import path from "path";
import fs from "fs";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
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

// ✅ Correção 2 (blindagem de acento/Unicode)
function safeText(v: any) {
  const s = String(v ?? "");
  // NFC evita "acentos quebrados" por composição
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function money(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

function percent(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0,00%";
  return (n * 100).toFixed(2).replace(".", ",") + "%";
}

function parseMesRef(mesRef: string) {
  // espera YYYY-MM-01 (ou YYYY-MM-DD)
  const d = new Date(mesRef);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function previousMonthDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0..11
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return prev;
}

function monthNamePtBr(m: number) {
  const names = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  return names[m] ?? "";
}

function labelMes(d: Date) {
  const mes = monthNamePtBr(d.getUTCMonth());
  const ano = d.getUTCFullYear();
  return `${mes} de ${ano}`;
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return jsonError("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return jsonError("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = url.searchParams.get("mes_ref") || "";
    if (!mes_ref) return jsonError("Parâmetro mes_ref obrigatório (YYYY-MM-01)", 400);

    const baseUrl = getBaseUrlFromReq(req);
    if (!baseUrl) return jsonError("Não foi possível determinar baseUrl", 500);

    const cookie = req.headers.get("cookie") || "";

    // ✅ Fonte da verdade: JSON base (que já filtra em_conferencia)
    const r = await fetch(
      `${baseUrl}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`,
      { cache: "no-store", headers: cookie ? { cookie } : {} }
    );

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return jsonError(`Falha ao gerar base do relatório (${r.status}). ${t}`, 500);
    }

    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.rows) ? j.rows : [];

    const d = parseMesRef(mes_ref);
    const dPrev = d ? previousMonthDate(d) : null;

    const mesX = d ? labelMes(d) : safeText(mes_ref);
    const mesY = dPrev ? labelMes(dPrev) : "mês anterior";

    // ✅ Título conforme pedido
    const titulo = safeText(
      `RELATORIO PAGAMENTOS CONDOMINIOS MES ${mesX.toUpperCase()}, REFERENTE MES ${String(mesY).toUpperCase()} (ANTERIOR)`
    );

    // --- PDFKit com fontes TTF (UTF-8 ok) ---
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const pass = new PassThrough();
    doc.pipe(pass);

    const fontRegular = path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf");
    const fontBold = path.join(process.cwd(), "public", "fonts", "Roboto-Bold.ttf");

    if (!fs.existsSync(fontRegular) || !fs.existsSync(fontBold)) {
      doc.end();
      return jsonError(
        "Fontes não encontradas. Confirme: public/fonts/Roboto-Regular.ttf e public/fonts/Roboto-Bold.ttf no repositório.",
        500
      );
    }

    doc.registerFont("R", fontRegular);
    doc.registerFont("B", fontBold);

    // ✅ Correção 1 (evita PDFKit cair na Helvetica.afm): setar fonte TTF antes de qualquer texto
    doc.font("B");

    // Header
    doc.fontSize(13).text(titulo, { align: "center" });
    doc.moveDown(0.6);
    doc.font("R").fontSize(9).fillColor("#333");
    doc.text(safeText(`Gerado em: ${new Date().toLocaleString("pt-BR")}`), { align: "center" });
    doc.moveDown(0.8);

    // Linha separadora do cabeçalho
    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(1)
      .strokeColor("#cccccc")
      .stroke();

    doc.moveDown(0.8);

    if (!rows.length) {
      doc.font("R").fontSize(11).fillColor("#000");
      doc.text("Sem auditorias em conferência para este mês.");
      doc.end();
      return new Response(nodeStreamToWebReadable(pass) as any, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="relatorio_pagamentos_${mes_ref}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Conteúdo
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};

      const nome = safeText(row.condominio_nome ?? "Condomínio");
      const pagamento = safeText(row.pagamento_texto ?? "");
      const repasse = money(row.repasse);
      const cashback = money(row.cashback);
      const total = money(row.total);
      const variacao = percent(row.variacao_percent);

      // Quebra de página preventiva
      if (doc.y > 760) doc.addPage();

      // Bloco do condomínio
      doc.font("B").fontSize(12).fillColor("#000").text(nome);
      doc.font("R").fontSize(10).fillColor("#111").text(pagamento);

      doc.moveDown(0.3);

      // Mini-tabela (3 colunas)
      const x0 = doc.page.margins.left;
      const x1 = x0 + 190;
      const x2 = x0 + 340;

      const yTable = doc.y;

      doc.font("B").fontSize(9).fillColor("#333");
      doc.text("Repasse (R$)", x0, yTable);
      doc.text("Cashback (R$)", x1, yTable);
      doc.text("Total (R$)", x2, yTable);

      doc.font("R").fontSize(10).fillColor("#000");
      doc.text(`R$ ${repasse}`, x0, yTable + 14);
      doc.text(`R$ ${cashback}`, x1, yTable + 14);
      doc.text(`R$ ${total}`, x2, yTable + 14);

      doc.moveDown(2.2);

      doc.font("R").fontSize(10).fillColor("#000");
      doc.text(safeText(`Variação vs mês anterior: ${variacao}`));

      doc.moveDown(0.6);

      // Linha separadora entre condomínios
      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .lineWidth(0.8)
        .strokeColor("#e0e0e0")
        .stroke();

      doc.moveDown(0.8);
    }

    doc.end();

    return new Response(nodeStreamToWebReadable(pass) as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio_pagamentos_${mes_ref}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message ?? "Erro inesperado", 500);
  }
}
