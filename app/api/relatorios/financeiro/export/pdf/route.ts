export const runtime = "nodejs";

import { getUserAndRole } from "@/lib/auth";

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

function pdfEscape(s: string) {
  // escape \ ( ) e remove chars de controle
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0000-\u001F\u007F]/g, " ");
}

/**
 * Gera um PDF básico, com fonte padrão Helvetica (Type1) sem depender de PDFKit.
 * Suporta múltiplas páginas se precisar.
 */
function buildSimplePdf(pages: string[]) {
  const objects: string[] = [];

  // 1) Catalog
  // 2) Pages
  // 3..n) Page objects + Contents
  // Font object: Helvetica (Type1) - padrão do PDF

  const addObject = (content: string) => {
    objects.push(content);
    return objects.length; // id 1-based
  };

  const fontObjId = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  const pageObjIds: number[] = [];
  const contentObjIds: number[] = [];

  // Page tree placeholder, vamos criar depois que soubermos pages
  const pagesObjId = addObject(`<< /Type /Pages /Kids [] /Count 0 >>`);

  // Catalog
  const catalogObjId = addObject(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  // Create pages
  for (const pageContentStream of pages) {
    const contentBytes = Buffer.from(pageContentStream, "utf8");
    const contentObjId = addObject(
      `<< /Length ${contentBytes.length} >>\nstream\n${pageContentStream}\nendstream`
    );
    contentObjIds.push(contentObjId);

    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    pageObjIds.push(pageObjId);
  }

  // Update Pages object (Kids/Count)
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesObjId - 1] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageObjIds.length} >>`;

  // Build xref
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0]; // object 0
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    const off = String(offsets[i]).padStart(10, "0");
    pdf += `${off} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

function makePagesFromRows(title: string, rows: any[]) {
  // coordenadas
  const left = 50;
  let y = 800;
  const lineH = 14;

  const pageStreams: string[] = [];
  let lines: string[] = [];

  const flushPage = () => {
    // monta stream PDF com texto
    // BT ... ET
    // usamos Td absoluto por linha (mais simples)
    const content =
      "BT\n/F1 12 Tf\n" +
      lines.join("\n") +
      "\nET\n";
    pageStreams.push(content);
    lines = [];
    y = 800;
  };

  const addLine = (text: string, size = 12, bold = false) => {
    // fonte continua F1; só muda tamanho
    const safe = pdfEscape(text);
    lines.push(`/F1 ${size} Tf`);
    lines.push(`${left} ${y} Td (${safe}) Tj`);
    // volta origem do texto (Td é relativo), então precisamos "resetar" movendo de volta:
    lines.push(`${-left} ${-y} Td`);
    y -= lineH;

    if (y < 80) flushPage();
  };

  // título
  addLine(title, 14, true);
  y -= 6;

  if (!rows.length) {
    addLine("Sem auditorias em conferência para este mês.", 12);
    flushPage();
    return pageStreams;
  }

  for (const r of rows) {
    addLine(String(r?.condominio_nome ?? "Condomínio"), 12);
    addLine(String(r?.pagamento_texto ?? ""), 10);
    addLine(`Repasse: R$ ${money(r?.repasse)}`, 10);
    addLine(`Cashback: R$ ${money(r?.cashback)}`, 10);
    addLine(`Total: R$ ${money(r?.total)}`, 10);
    addLine(`Variação vs mês anterior: ${percent(r?.variacao_percent)}`, 10);
    y -= 8;
    if (y < 80) flushPage();
  }

  flushPage();
  return pageStreams;
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

    const pages = makePagesFromRows(`Relatório Financeiro - ${mes_ref}`, rows);
    const pdfBytes = buildSimplePdf(pages);

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio_financeiro_${mes_ref}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message ?? "Erro inesperado", 500);
  }
}
