export const runtime = "nodejs";

import { getUserAndRole } from "@/lib/auth";
import fs from "fs";
import path from "path";

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

function safeAscii(v: any) {
  const s = String(v ?? "");
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0000-\u001F\u007F]/g, " ");
}

function parseMesRef(mesRef: string) {
  const d = new Date(mesRef);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function previousMonthDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m - 1, 1));
}

function monthNamePtBrAscii(m: number) {
  const names = [
    "janeiro",
    "fevereiro",
    "marco",
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
  const mes = monthNamePtBrAscii(d.getUTCMonth());
  const ano = d.getUTCFullYear();
  return `${mes} de ${ano}`;
}

function nowBrasil() {
  // Brasil UTC-3 (sem horário de verão)
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d;
}

// -------- JPEG dimension (Width/Height) --------
function getJpegSize(buf: Buffer): { width: number; height: number } | null {
  // JPEG starts with FF D8
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }

    // skip fill bytes FF FF...
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;

    const marker = buf[i];
    i++;

    // markers without length
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS

    if (i + 1 >= buf.length) break;
    const len = buf.readUInt16BE(i);
    i += 2;

    if (len < 2 || i + (len - 2) > buf.length) break;

    // SOF markers (baseline/progressive etc)
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSOF) {
      if (i + 7 > buf.length) return null;
      // [precision(1)][height(2)][width(2)]...
      const height = buf.readUInt16BE(i + 1);
      const width = buf.readUInt16BE(i + 3);
      return { width, height };
    }

    i += len - 2;
  }

  return null;
}

// -------- PDF builder (minimal, supports JPEG XObject) --------
function buildSimplePdfWithJpeg(pages: { content: string; useLogo: boolean }[], logo?: {
  jpg: Buffer;
  width: number;
  height: number;
}) {
  const objects: string[] = [];
  const binStreams: { id: number; bytes: Buffer }[] = [];

  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const addBinaryStreamObject = (dict: string, bytes: Buffer) => {
    const id = addObject(`${dict}\nstream\n(BINARY_PLACEHOLDER_${objects.length + 1})\nendstream`);
    binStreams.push({ id, bytes });
    return id;
  };

  const fontObjId = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  const pagesObjId = addObject(`<< /Type /Pages /Kids [] /Count 0 >>`);
  const catalogObjId = addObject(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  let imgObjId: number | null = null;
  if (logo && logo.jpg?.length) {
    // JPEG embedded as DCTDecode
    const dict =
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpg.length} >>`;
    imgObjId = addBinaryStreamObject(dict, logo.jpg);
  }

  const pageObjIds: number[] = [];

  for (const page of pages) {
    const contentBytes = Buffer.from(page.content, "utf8");
    const contentObjId = addObject(
      `<< /Length ${contentBytes.length} >>\nstream\n${page.content}\nendstream`
    );

    const resourcesParts = [`/Font << /F1 ${fontObjId} 0 R >>`];
    if (page.useLogo && imgObjId) {
      resourcesParts.push(`/XObject << /Im1 ${imgObjId} 0 R >>`);
    }

    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 595 842] /Resources << ${resourcesParts.join(
        " "
      )} >> /Contents ${contentObjId} 0 R >>`
    );

    pageObjIds.push(pageObjId);
  }

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesObjId - 1] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageObjIds.length} >>`;

  // Build PDF with correct xref, injecting binary streams
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  // We'll render objects, replacing placeholders for binary streams
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    const objId = i + 1;

    let body = objects[i];

    // Replace placeholder if it's a binary stream object
    const bin = binStreams.find((b) => b.id === objId);
    if (bin) {
      // dict part ends before "stream"
      const idx = body.indexOf("\nstream\n");
      const dictPart = idx >= 0 ? body.slice(0, idx) : body;
      const trailer = "\nendstream";

      // write object header + dict + stream + raw bytes + endstream
      pdf += `${objId} 0 obj\n`;
      pdf += dictPart + "\nstream\n";
      // raw bytes
      pdf += bin.bytes.toString("binary");
      pdf += trailer + "\nendobj\n";
      continue;
    }

    pdf += `${objId} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    const off = String(offsets[i]).padStart(10, "0");
    pdf += `${off} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "binary");
}

// -------- Layout: padrão contábil + logo --------
function makeAccountingPages(opts: {
  titleLine1: string;
  titleLine2: string;
  generatedAt: string;
  rows: any[];
  useLogo: boolean;
}) {
  const { titleLine1, titleLine2, generatedAt, rows, useLogo } = opts;

  // A4: 595 x 842
  const left = 50;
  const right = 545;
  const top = 800;
  const lineH = 14;
  let y = top;

  const pages: { content: string; useLogo: boolean }[] = [];
  let ops: string[] = [];

  const flush = () => {
    pages.push({ content: ops.join("\n") + "\n", useLogo });
    ops = [];
    y = top;
  };

  const text = (x: number, yy: number, s: string, fontSize: number) => {
    const safe = pdfEscape(safeAscii(s));
    ops.push("BT");
    ops.push(`/F1 ${fontSize} Tf`);
    ops.push(`${x} ${yy} Td`);
    ops.push(`(${safe}) Tj`);
    ops.push("ET");
  };

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ops.push("0.7 w");
    ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };

  const ensureSpace = (need: number) => {
    if (y - need < 80) flush();
  };

  // Logo (only on first page)
  if (useLogo) {
    // place logo at top-left: width ~120
    // PDF cm: [w 0 0 h x y]
    // y is bottom-left of image
    ops.push("q");
    ops.push(`120 0 0 40 ${left} 792 cm`); // 120x40
    ops.push("/Im1 Do");
    ops.push("Q");
  }

  // Header (dentro do A4, sem estourar)
  ensureSpace(120);
  const headerX = left + 140; // deixa espaço visual da logo
  text(headerX, y, titleLine1, 12);
  y -= 16;
  text(headerX, y, titleLine2, 10);
  y -= 14;
  text(headerX, y, `Gerado em: ${generatedAt}`, 9);
  y -= 18;
  line(left, y, right, y);
  y -= 20;

  if (!rows.length) {
    ensureSpace(30);
    text(left, y, "SEM AUDITORIAS EM CONFERENCIA PARA ESTE MES.", 11);
    y -= 20;
    flush();
    return pages;
  }

  // Body (padrão contábil)
  for (const r of rows) {
    ensureSpace(140);

    const condoLine = `CONDOMINIO: ${String(r?.condominio_nome ?? "CONDOMINIO")}`;
    const payLine = `FORMA DE PAGAMENTO: ${String(r?.pagamento_texto ?? "")}`;

    text(left, y, condoLine, 11);
    y -= 16;

    text(left, y, payLine, 9);
    y -= 14;

    line(left, y, right, y);
    y -= 18;

    text(left, y, "DESCRICAO", 9);
    text(right - 120, y, "VALOR (R$)", 9);
    y -= 14;

    text(left, y, "Repasse (consumos)", 9);
    text(right - 120, y, money(r?.repasse), 9);
    y -= lineH;

    text(left, y, "Cashback", 9);
    text(right - 120, y, money(r?.cashback), 9);
    y -= 10;

    line(right - 170, y, right, y);
    y -= 14;

    text(left, y, "TOTAL A PAGAR", 10);
    text(right - 120, y, money(r?.total), 10);
    y -= 14;

    text(left, y, "Variacao vs mes anterior", 9);
    text(right - 120, y, percent(r?.variacao_percent), 9);
    y -= 18;

    line(left, y, right, y);
    y -= 20;
  }

  flush();
  return pages;
}

function readLogoFromPublic(): { jpg: Buffer; width: number; height: number } | null {
  // Prefer: public/logo.jpg (conforme print)
  const candidates = ["logo.jpg", "logo Meta Lav.jpg"];

  for (const name of candidates) {
    const p = path.join(process.cwd(), "public", name);
    try {
      if (fs.existsSync(p)) {
        const jpg = fs.readFileSync(p);
        const size = getJpegSize(jpg);
        if (!size) return null;
        return { jpg, width: size.width, height: size.height };
      }
    } catch {
      // ignore and try next
    }
  }
  return null;
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

    const d = parseMesRef(mes_ref);
    const dPrev = d ? previousMonthDate(d) : null;

    const mesX = d ? labelMes(d) : mes_ref;
    const mesY = dPrev ? labelMes(dPrev) : "mes anterior";

    const titleLine1 = "META-LAV | RELATORIO DE PAGAMENTOS A CONDOMINIOS";
    const titleLine2 = `MES: ${String(mesX).toUpperCase()} | REFERENTE: ${String(mesY).toUpperCase()}`;
    const generatedAt = nowBrasil().toLocaleString("pt-BR");

    const logo = readLogoFromPublic(); // pode ser null; PDF continua sem logo se não achar
    const pages = makeAccountingPages({
      titleLine1,
      titleLine2,
      generatedAt,
      rows,
      useLogo: !!logo,
    });

    const pdfBytes = buildSimplePdfWithJpeg(
      pages,
      logo ? { jpg: logo.jpg, width: logo.width, height: logo.height } : undefined
    );

    return new Response(pdfBytes, {
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
