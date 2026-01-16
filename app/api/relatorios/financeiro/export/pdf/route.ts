function nowBrasil() {
  // Brasil = UTC-3 (sem horário de verão)
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d;
}
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

function safeAscii(v: any) {
  // remove acentos/diacriticos para nao aparecer " " no PDF simples
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

function monthNamePtBr(m: number) {
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
  const mes = monthNamePtBr(d.getUTCMonth());
  const ano = d.getUTCFullYear();
  return `${mes} de ${ano}`;
}

function pdfEscape(s: string) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0000-\u001F\u007F]/g, " ");
}

/**
 * PDF minimalista SEM PDFKit (evita Helvetica.afm no serverless).
 * Fonte: Helvetica (Type1) built-in.
 * Obs: por ser Type1, usamos ASCII para evitar caracter quebrado.
 */
function buildSimplePdf(pages: string[]) {
  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const fontObjId = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  const pagesObjId = addObject(`<< /Type /Pages /Kids [] /Count 0 >>`);
  const catalogObjId = addObject(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  const pageObjIds: number[] = [];

  for (const pageStream of pages) {
    const contentBytes = Buffer.from(pageStream, "utf8");
    const contentObjId = addObject(
      `<< /Length ${contentBytes.length} >>\nstream\n${pageStream}\nendstream`
    );

    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );

    pageObjIds.push(pageObjId);
  }

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesObjId - 1] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageObjIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

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

function makePages(title: string, rows: any[]) {
  const left = 50;
  const right = 545;
  const top = 800;
  const lineH = 14;
  let y = top;

  const pageStreams: string[] = [];
  let ops: string[] = [];

  const flush = () => {
    const content = ops.join("\n") + "\n";
    pageStreams.push(content);
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

  // HEADER
ensureSpace(80);

text(90, y, titleLine1, 13);
y -= 18;

text(90, y, titleLine2, 11);
y -= 18;

text(90, y, `Gerado em: ${nowBrasil().toLocaleString("pt-BR")}`, 9);
y -= 14;

line(left, y, right, y);
y -= 18;


  if (!rows.length) {
    ensureSpace(30);
    text(left, y, "SEM AUDITORIAS EM CONFERENCIA PARA ESTE MES.", 11);
    y -= 20;
    flush();
    return pageStreams;
  }

  for (const r of rows) {
    ensureSpace(120);

    text(left, y, String(r?.condominio_nome ?? "CONDOMINIO"), 12);
    y -= 16;

    text(left, y, String(r?.pagamento_texto ?? ""), 10);
    y -= 16;

    text(left, y, `REPASSE: R$ ${money(r?.repasse)}`, 10);
    y -= 14;

    text(left, y, `CASHBACK: R$ ${money(r?.cashback)}`, 10);
    y -= 14;

    text(left, y, `TOTAL: R$ ${money(r?.total)}`, 10);
    y -= 14;

    text(left, y, `VARIACAO VS MES ANTERIOR: ${percent(r?.variacao_percent)}`, 10);
    y -= 18;

    line(left, y, right, y);
    y -= 18;
  }

  flush();
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

    const d = parseMesRef(mes_ref);
    const dPrev = d ? previousMonthDate(d) : null;

    const mesX = d ? labelMes(d) : mes_ref;
    const mesY = dPrev ? labelMes(dPrev) : "mes anterior";

    const title = `RELATORIO PAGAMENTOS CONDOMINIOS MES ${String(mesX).toUpperCase()}, REFERENTE MES ${String(
      mesY
    ).toUpperCase()} (ANTERIOR)`;

    const pages = makePages(title, rows);
    const pdfBytes = buildSimplePdf(pages);

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
