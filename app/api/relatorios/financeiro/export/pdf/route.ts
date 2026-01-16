export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole } from "@/lib/auth";
import fs from "fs";
import path from "path";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function nowBrasil() {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d;
}

function parseMesRef(input: string | null) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return null;
}

function monthNamePt(isoYYYYMMDD: string) {
  const d = new Date(`${isoYYYYMMDD}T00:00:00Z`);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const nomes = [
    "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
    "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
  ];
  return `${nomes[month]} DE ${year}`;
}

function addMonths(isoYYYYMMDD: string, delta: number) {
  const d = new Date(`${isoYYYYMMDD}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const newD = new Date(Date.UTC(y, m + delta, 1));
  const yy = newD.getUTCFullYear();
  const mm = String(newD.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function formatMoney(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number) {
  return (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

/**
 * Minimal PDF generator (Type1 base fonts Helvetica / Helvetica-Bold).
 * No PDFKit, no AFM files -> avoids Helvetica.afm error.
 * Text encoding: WinAnsi-like via CP1252 mapping, emitted as hex string.
 */

function toCp1252Bytes(str: string): Uint8Array {
  const map: Record<string, number> = {
    "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
    "ˆ": 0x88, "‰": 0x89, "Š": 0x8A, "‹": 0x8B, "Œ": 0x8C, "Ž": 0x8E,
    "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
    "˜": 0x98, "™": 0x99, "š": 0x9A, "›": 0x9B, "œ": 0x9C, "ž": 0x9E, "Ÿ": 0x9F,
  };
  const out: number[] = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code <= 0x7F) out.push(code);
    else if (code >= 0xA0 && code <= 0xFF) out.push(code);
    else if (map[ch] !== undefined) out.push(map[ch]);
    else out.push(0x3F); // '?'
  }
  return Uint8Array.from(out);
}

function hexOfBytes(b: Uint8Array) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}

function readLogoJpegBytes(): Uint8Array | null {
  const candidates = [
    path.join(process.cwd(), "public", "logo Meta Lav.jpg"),
    path.join(process.cwd(), "public", "logo.jpg"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        return new Uint8Array(buf);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// parse JPEG width/height (SOF0/SOF2)
function getJpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    let i = 0;
    if (bytes[i] !== 0xFF || bytes[i + 1] !== 0xD8) return null; // SOI
    i += 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      i += 2;
      // EOI / SOS
      if (marker === 0xD9 || marker === 0xDA) break;
      const len = (bytes[i] << 8) + bytes[i + 1];
      if (len < 2) return null;
      // SOF0..SOF3, SOF2
      const isSOF =
        (marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF);
      if (isSOF) {
        const h = (bytes[i + 3] << 8) + bytes[i + 4];
        const w = (bytes[i + 5] << 8) + bytes[i + 6];
        return { w, h };
      }
      i += len;
    }
  } catch {
    // ignore
  }
  return null;
}

type PdfObj = { id: number; body: Uint8Array };

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function strBytes(s: string) {
  return new TextEncoder().encode(s);
}

function buildPdf(pages: string[], logo?: { bytes: Uint8Array; w: number; h: number } | null) {
  // A4 in points
  const W = 595.28;
  const H = 841.89;

  let nextId = 1;
  const objs: PdfObj[] = [];

  const newObjId = () => nextId++;

  // Fonts
  const fontRegularId = newObjId();
  objs.push({
    id: fontRegularId,
    body: strBytes(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`),
  });

  const fontBoldId = newObjId();
  objs.push({
    id: fontBoldId,
    body: strBytes(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`),
  });

  // Image (optional)
  let imageId: number | null = null;
  if (logo?.bytes) {
    imageId = newObjId();
    const imgStream = concatBytes([
      strBytes(
        `<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`
      ),
      logo.bytes,
      strBytes(`\nendstream`),
    ]);
    objs.push({ id: imageId, body: imgStream });
  }

  // Content streams
  const contentIds: number[] = [];
  for (const p of pages) {
    const cid = newObjId();
    const data = strBytes(p);
    const stream = concatBytes([
      strBytes(`<< /Length ${data.length} >>\nstream\n`),
      data,
      strBytes(`\nendstream`),
    ]);
    objs.push({ id: cid, body: stream });
    contentIds.push(cid);
  }

  // Pages tree + individual pages
  const pagesId = newObjId();
  const pageIds: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pid = newObjId();
    pageIds.push(pid);

    const resourcesParts: string[] = [];
    resourcesParts.push(`/Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>`);
    if (imageId) resourcesParts.push(`/XObject << /Im1 ${imageId} 0 R >>`);

    objs.push({
      id: pid,
      body: strBytes(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << ${resourcesParts.join(
          " "
        )} >> /Contents ${contentIds[i]} 0 R >>`
      ),
    });
  }

  objs.push({
    id: pagesId,
    body: strBytes(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`),
  });

  // Catalog
  const catalogId = newObjId();
  objs.push({ id: catalogId, body: strBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`) });

  // Build xref
  const header = strBytes(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`);
  let offset = header.length;
  const parts: Uint8Array[] = [header];

  const xref: number[] = [];
  xref[0] = 0;

  for (const o of objs) {
    xref[o.id] = offset;
    const chunk = concatBytes([strBytes(`${o.id} 0 obj\n`), o.body, strBytes(`\nendobj\n`)]);
    parts.push(chunk);
    offset += chunk.length;
  }

  const xrefStart = offset;
  const maxId = objs.reduce((m, o) => Math.max(m, o.id), 0);
  let xrefText = `xref\n0 ${maxId + 1}\n`;
  xrefText += `0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    const off = xref[i] ?? 0;
    xrefText += `${String(off).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(strBytes(xrefText));
  parts.push(strBytes(trailer));

  return concatBytes(parts);
}

function escapeHexText(s: string) {
  return `<${hexOfBytes(toCp1252Bytes(s))}>`;
}

function pdfText(font: "F1" | "F2", size: number, x: number, y: number, s: string) {
  // uses hex string, so no escaping parentheses needed
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${escapeHexText(s)} Tj ET\n`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number, w = 0.7) {
  return `${w.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}

function pdfImage(x: number, y: number, w: number, h: number) {
  // /Im1 Do
  return `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q\n`;
}

function getBaseUrl(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

async function fetchBaseJson(req: Request, mes_ref: string) {
  const base = getBaseUrl(req);
  const cookie = req.headers.get("cookie");
  const res = await fetch(`${base}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`, {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(json?.error || text || `HTTP ${res.status}`);
  }
  return json;
}

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = parseMesRef(url.searchParams.get("mes_ref"));
    if (!mes_ref) return bad("Parâmetro mes_ref inválido. Use YYYY-MM-01", 400);

    const base = await fetchBaseJson(req, mes_ref);
    const itens: any[] = Array.isArray(base?.itens) ? base.itens : [];

    const mesX = monthNamePt(mes_ref);
    const mesY = monthNamePt(addMonths(mes_ref, -1));

    // Totais gerais
    const totalRepasse = itens.reduce((acc, it) => acc + Number(it?.repasse ?? 0), 0);
    const totalCashback = itens.reduce((acc, it) => acc + Number(it?.cashback ?? 0), 0);
    const totalGeral = itens.reduce((acc, it) => acc + Number(it?.total ?? 0), 0);

    // Layout constants
    const left = 50;
    const right = 545;
    const top = 800;
    const bottom = 55;
    const footerH = 22; // reserved
    const pageW = 595.28;
    const pageH = 841.89;

    // Logo load
    const logoBytes = readLogoJpegBytes();
    const logoSize = logoBytes ? getJpegSize(logoBytes) : null;
    const logo = logoBytes && logoSize ? { bytes: logoBytes, w: logoSize.w, h: logoSize.h } : null;

    // Build pages (without footer). We'll append footer after we know total pages.
    const pages: string[] = [];
    let content = "";
    let y = top;

    const ensureSpace = (needed: number) => {
      if (y - needed < bottom + footerH) {
        pages.push(content);
        content = "";
        y = top;
        // header repeated on new page (small)
        content += pdfText("F2", 10, left, y, "META-LAV | RELATORIO DE PAGAMENTOS A CONDOMINIOS");
        y -= 14;
        content += pdfText("F1", 9, left, y, `MES: ${mesX} | REFERENTE: ${mesY}`);
        y -= 12;
        content += pdfLine(left, y, right, y, 0.6);
        y -= 16;
      }
    };

    // Header (first page)
    const headerY = y;

    if (logo) {
      // fit logo height ~ 28
      const targetH = 28;
      const scale = targetH / logo.h;
      const w = logo.w * scale;
      const h = targetH;
      content += pdfImage(left, headerY - h + 6, w, h);
    }

    content += pdfText("F2", 12, left + (logo ? 110 : 0), y, "META-LAV | RELATORIO DE PAGAMENTOS A CONDOMINIOS");
    y -= 16;
    content += pdfText("F1", 10, left + (logo ? 110 : 0), y, `MES: ${mesX} | REFERENTE: ${mesY}`);
    y -= 14;
    content += pdfText("F1", 9, left + (logo ? 110 : 0), y, `Gerado em: ${nowBrasil().toLocaleString("pt-BR")}`);
    y -= 14;
    content += pdfLine(left, y, right, y, 0.8);
    y -= 18;

    // Body blocks
    for (const it of itens) {
      ensureSpace(150);

      const nome = String(it?.condominio_nome ?? "").trim() || "CONDOMINIO";
      const pagamento = String(it?.pagamento_texto ?? "").trim();
      const repasse = Number(it?.repasse ?? 0);
      const cashback = Number(it?.cashback ?? 0);
      const total = Number(it?.total ?? 0);
      const variacao = Number(it?.variacao ?? 0);

      content += pdfText("F2", 10, left, y, `CONDOMINIO: ${nome}`);
      y -= 14;

      content += pdfText("F1", 9, left, y, `FORMA DE PAGAMENTO: ${pagamento}`);
      y -= 12;

      content += pdfLine(left, y, right, y, 0.6);
      y -= 18;

      // Table header
      content += pdfText("F2", 9, left, y, "DESCRICAO");
      content += pdfText("F2", 9, right - 110, y, "VALOR (R$)");
      y -= 12;

      // Rows
      content += pdfText("F1", 9, left, y, "Repasse (consumos)");
      content += pdfText("F1", 9, right - 110, y, formatMoney(repasse));
      y -= 12;

      content += pdfText("F1", 9, left, y, "Cashback");
      content += pdfText("F1", 9, right - 110, y, formatMoney(cashback));
      y -= 12;

      // Separator + total
      content += pdfLine(right - 160, y + 6, right, y + 6, 0.8);
      y -= 2;

      content += pdfText("F2", 10, left, y, "TOTAL A PAGAR");
      content += pdfText("F2", 10, right - 110, y, formatMoney(total));
      y -= 14;

      content += pdfText("F1", 9, left, y, "Variacao vs mes anterior");
      content += pdfText("F1", 9, right - 110, y, formatPct(variacao));
      y -= 16;

      content += pdfLine(left, y, right, y, 0.6);
      y -= 18;
    }

    // Elegant total line at end
    ensureSpace(70);
    content += pdfText("F2", 10, left, y, "TOTAIS DO MES");
    y -= 12;
    content += pdfLine(left, y, right, y, 0.8);
    y -= 14;

    // Elegant single-line totals (label + values aligned)
    content += pdfText("F1", 9, left, y, "Repasse:");
    content += pdfText("F2", 9, left + 55, y, `R$ ${formatMoney(totalRepasse)}`);
    content += pdfText("F1", 9, left + 210, y, "Cashback:");
    content += pdfText("F2", 9, left + 275, y, `R$ ${formatMoney(totalCashback)}`);
    content += pdfText("F1", 9, left + 420, y, "Total:");
    content += pdfText("F2", 9, left + 465, y, `R$ ${formatMoney(totalGeral)}`);
    y -= 14;

    content += pdfLine(left, y, right, y, 0.8);
    y -= 10;

    pages.push(content);

    // Now append footer with page numbers to each page (we know total pages)
    const totalPages = pages.length;

    const pagesWithFooter = pages.map((p, idx) => {
      const pageNo = idx + 1;
      const footerY = 28;
      let f = p;
      f += pdfLine(left, footerY + 18, right, footerY + 18, 0.6);
      f += pdfText("F1", 8, left, footerY + 6, "Meta-Lav • Relatorio gerado automaticamente");
      const rightText = `Pagina ${pageNo} de ${totalPages}`;
      // approximate right align by positioning near right edge
      f += pdfText("F1", 8, right - 80, footerY + 6, rightText);
      return f;
    });

    const pdfBytes = buildPdf(pagesWithFooter, logo);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio_pagamentos_${mes_ref}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad("Falha ao gerar PDF", 500, { details: e?.message ?? String(e) });
  }
}
