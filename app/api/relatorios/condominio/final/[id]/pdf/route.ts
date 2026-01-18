export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { getUserAndRole, roleGte, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function safeText(v: any) {
  return String(v ?? "");
}
function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtBRL(v: any) {
  const x = n(v);
  return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtNum(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function fmtLeitura(v: any) {
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}

function getOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "http://localhost";
}

/**
 * ============ PDF MINIMAL (IGUAL AO FINANCEIRO) ============
 * - fontes Type1 base (Helvetica / Helvetica-Bold)
 * - texto em CP1252/WinAnsi (hex)
 * - imagem: SOMENTE JPEG via DCTDecode (logo e anexos jpg)
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
    if (code <= 0x7f) out.push(code);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else if (map[ch] !== undefined) out.push(map[ch]);
    else out.push(0x3f); // '?'
  }
  return Uint8Array.from(out);
}
function hexOfBytes(b: Uint8Array) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}
function escapeHexText(s: string) {
  return `<${hexOfBytes(toCp1252Bytes(s))}>`;
}

function strBytes(s: string) {
  return new TextEncoder().encode(s);
}
function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

type PdfObj = { id: number; body: Uint8Array };

function pdfText(font: "F1" | "F2", size: number, x: number, y: number, s: string) {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${escapeHexText(s)} Tj ET\n`;
}
function pdfLine(x1: number, y1: number, x2: number, y2: number, w = 0.7) {
  return `${w.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}
function pdfRect(x: number, y: number, w: number, h: number, lineW = 0.7) {
  // apenas stroke (sem fill) — estilo “banco”
  return `${lineW.toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S\n`;
}
function pdfImage(x: number, y: number, w: number, h: number, name: string) {
  return `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q\n`;
}

// JPEG helpers
function isJpeg(bytes: Uint8Array) {
  return bytes?.[0] === 0xff && bytes?.[1] === 0xd8;
}
function getJpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    let i = 0;
    if (!isJpeg(bytes)) return null;
    i += 2; // SOI
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0xd9 || marker === 0xda) break; // EOI/SOS
      const len = (bytes[i] << 8) + bytes[i + 1];
      if (len < 2) return null;

      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSOF) {
        const h = (bytes[i + 3] << 8) + bytes[i + 4];
        const w = (bytes[i + 5] << 8) + bytes[i + 6];
        return { w, h };
      }
      i += len;
    }
  } catch {}
  return null;
}

function readLogoJpegFromPublic(): { bytes: Uint8Array; w: number; h: number } | null {
  const candidates = [
    path.join(process.cwd(), "public", "logo Meta Lav.jpg"),
    path.join(process.cwd(), "public", "logo.jpg"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const bytes = new Uint8Array(buf);
        if (!isJpeg(bytes)) continue;
        const sz = getJpegSize(bytes);
        if (!sz) continue;
        return { bytes, w: sz.w, h: sz.h };
      }
    } catch {}
  }
  return null;
}

/**
 * ============ SUPABASE STORAGE (ROBUSTO) ============
 * Se a URL apontar para o Storage do Supabase, baixamos via supabaseAdmin().storage.download()
 * Isso resolve Storage privado / signed URL / etc.
 */
function parseSupabaseStorageUrl(u: string): { bucket: string; objectPath: string } | null {
  try {
    const url = new URL(u);
    const p = url.pathname || "";

    // Ex.: /storage/v1/object/public/<bucket>/<path...>
    // Ex.: /storage/v1/object/sign/<bucket>/<path...>
    // Ex.: /storage/v1/object/<bucket>/<path...> (variações)
    const idx = p.indexOf("/storage/v1/object/");
    if (idx === -1) return null;

    const rest = p.slice(idx + "/storage/v1/object/".length); // "public/<bucket>/<path...>" ou "sign/<bucket>/<path...>"
    const parts = rest.split("/").filter(Boolean);

    if (parts.length < 2) return null;

    // remove prefix (public|sign) se existir
    let offset = 0;
    if (parts[0] === "public" || parts[0] === "sign" || parts[0] === "authenticated") {
      offset = 1;
    }

    const bucket = parts[offset];
    const objectPath = parts.slice(offset + 1).join("/");

    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  } catch {
    return null;
  }
}

async function downloadViaSupabaseStorage(url: string): Promise<Uint8Array | null> {
  const parsed = parseSupabaseStorageUrl(url);
  if (!parsed) return null;

  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.objectPath);
    if (error || !data) return null;

    const ab = await data.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

async function fetchImageAsJpeg(
  url: string,
  timeoutMs = 15000
): Promise<{ bytes: Uint8Array; w: number; h: number } | null> {
  const u = safeText(url).trim();
  if (!u) return null;

  // 1) Tenta via Supabase Storage (service role) — mais confiável
  const viaStorage = await downloadViaSupabaseStorage(u);
  if (viaStorage && isJpeg(viaStorage) && viaStorage.length <= 6 * 1024 * 1024) {
    const sz = getJpegSize(viaStorage);
    if (sz) return { bytes: viaStorage, w: sz.w, h: sz.h };
  }

  // 2) Fallback: fetch direto da URL (caso seja externa)
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(u, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;

    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);

    // só JPEG (DCTDecode) — PNG/PDF não entra aqui
    if (!isJpeg(bytes)) return null;

    // segurança (evita PDF gigante)
    if (bytes.length > 6 * 1024 * 1024) return null;

    const sz = getJpegSize(bytes);
    if (!sz) return null;

    return { bytes, w: sz.w, h: sz.h };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildPdf(
  pages: { content: string; xobjects: Record<string, { bytes: Uint8Array; w: number; h: number }> }[]
) {
  // A4 points
  const W = 595.28;
  const H = 841.89;

  let nextId = 1;
  const objs: PdfObj[] = [];
  const newObjId = () => nextId++;

  // fonts
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

  // per page image objects
  const pageImageObjIds: Array<Record<string, number>> = [];

  for (const pg of pages) {
    const map: Record<string, number> = {};
    for (const [name, im] of Object.entries(pg.xobjects)) {
      const imageId = newObjId();
      map[name] = imageId;
      const imgStream = concatBytes([
        strBytes(
          `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`
        ),
        im.bytes,
        strBytes(`\nendstream`),
      ]);
      objs.push({ id: imageId, body: imgStream });
    }
    pageImageObjIds.push(map);
  }

  // content streams
  const contentIds: number[] = [];
  for (const pg of pages) {
    const cid = newObjId();
    const data = strBytes(pg.content);
    const stream = concatBytes([
      strBytes(`<< /Length ${data.length} >>\nstream\n`),
      data,
      strBytes(`\nendstream`),
    ]);
    objs.push({ id: cid, body: stream });
    contentIds.push(cid);
  }

  // pages + catalog
  const pagesId = newObjId();
  const pageIds: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pid = newObjId();
    pageIds.push(pid);

    const xobj = pageImageObjIds[i] || {};
    const xobjPart =
      Object.keys(xobj).length > 0
        ? `/XObject << ${Object.entries(xobj)
            .map(([name, id]) => `/${name} ${id} 0 R`)
            .join(" ")} >>`
        : "";

    const resources = `<< /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> ${xobjPart} >>`;

    objs.push({
      id: pid,
      body: strBytes(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${resources} /Contents ${contentIds[i]} 0 R >>`
      ),
    });
  }

  objs.push({
    id: pagesId,
    body: strBytes(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`),
  });

  const catalogId = newObjId();
  objs.push({ id: catalogId, body: strBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`) });

  // xref
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

/**
 * ============ DADOS ============
 */
async function fetchReportJson(req: NextRequest, origin: string, auditoriaId: string) {
  const cookie = req.headers.get("cookie") || "";
  const res = await fetch(`${origin}/api/relatorios/condominio/final/${auditoriaId}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", cookie, Accept: "application/json" },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error ? safeText(json.error) : `Falha ao obter dados (HTTP ${res.status})`;
    throw new Error(msg);
  }

  // endpoint costuma retornar { ok: true, data }
  return json?.data ?? json;
}

function compactObs(s: string) {
  const t = safeText(s).trim();
  if (!t) return "—";
  return t.length > 220 ? t.slice(0, 217) + "…" : t;
}

/**
 * ============ RENDER ============
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const auditoriaId = safeText(params?.id).trim();
    if (!auditoriaId) return bad("ID inválido", 400);

    const origin = getOrigin(req);
    const data = await fetchReportJson(req, origin, auditoriaId);
    if (!data) return bad("Relatório sem dados", 404);

    const meta = data?.meta || {};
    const condominioNome = safeText(meta?.condominio_nome) || safeText(data?.condominio?.nome) || "—";
    const periodo = safeText(meta?.competencia) || safeText(data?.periodo) || "—";
    const geradoEm = safeText(meta?.gerado_em) || "";

    // vendas
    const vendas = Array.isArray(data?.vendas_por_maquina?.itens)
      ? data.vendas_por_maquina.itens.map((v: any) => ({
          maquina: safeText(v?.maquina),
          ciclos: n(v?.ciclos),
          valor_unitario: n(v?.valor_unitario),
          valor_total: n(v?.valor_total),
        }))
      : [];

    const receitaBruta = n(data?.vendas_por_maquina?.receita_bruta_total);
    const cashbackPct = n(data?.vendas_por_maquina?.cashback_percent);
    const cashbackValor = n(data?.vendas_por_maquina?.valor_cashback);

    // consumos (insumos)
    const consumos = Array.isArray(data?.consumo_insumos?.itens)
      ? data.consumo_insumos.itens.map((c: any) => ({
          nome: safeText(c?.insumo),
          anterior: c?.leitura_anterior ?? null,
          atual: c?.leitura_atual ?? null,
          consumo: n(c?.consumo),
          valor_total: n(c?.valor_total),
        }))
      : [];

    const totalConsumo = n(data?.consumo_insumos?.total_repasse_consumo);
    const totalCashback = n(data?.totalizacao_final?.cashback);
    const totalPagar = n(data?.totalizacao_final?.total_a_pagar_condominio);

    const obs = compactObs(data?.observacoes);

    // anexos (embutimos somente JPEG; PNG/PDF continua sem embutir neste gerador)
    const anexosRaw = data?.anexos || {};
    const candidates: Array<{ tipo: string; url: string }> = [
      { tipo: "Foto do medidor de Água", url: safeText(anexosRaw?.foto_agua_url) },
      { tipo: "Foto do medidor de Energia", url: safeText(anexosRaw?.foto_energia_url) },
      { tipo: "Foto do medidor de Gás", url: safeText(anexosRaw?.foto_gas_url) },
      { tipo: "Comprovante de pagamento", url: safeText(anexosRaw?.comprovante_fechamento_url) },
    ].filter((x) => x.url);

    // logo (JPEG local do /public)
    const logo = readLogoJpegFromPublic();

    /**
     * ============ LAYOUT (BANCO) ============
     */
    const left = 48;
    const right = 547;
    const top = 800;
    const bottom = 60;
    const footerY = 28;

    function header(pageNo: number, totalPages: number, hasLogo: boolean) {
      let s = "";
      const y0 = top;

      // topo
      s += pdfLine(left, y0, right, y0, 1.2);

      // logo + títulos
      if (hasLogo) {
        // logo altura ~ 34
        const targetH = 34;
        const scale = targetH / (logo?.h || 34);
        const w = (logo?.w || 120) * scale;
        const h = targetH;
        s += pdfImage(left, y0 - 48, w, h, "Logo");
      }

      s += pdfText("F2", 16, hasLogo ? left + 130 : left, y0 - 18, "Prestação de Contas");
      s += pdfText("F1", 10, hasLogo ? left + 130 : left, y0 - 34, "Lavanderia Compartilhada — Relatório final");

      // cartão meta à direita (retângulo)
      const cardW = 240;
      const cardH = 72;
      const cx = right - cardW;
      const cy = y0 - 78;
      s += pdfRect(cx, cy, cardW, cardH, 0.8);

      s += pdfText("F1", 8.5, cx + 10, cy + cardH - 16, "Condomínio");
      s += pdfText("F2", 10.5, cx + 10, cy + cardH - 30, condominioNome);

      s += pdfText("F1", 8.5, cx + 10, cy + cardH - 46, "Competência");
      s += pdfText("F2", 10.5, cx + 10, cy + cardH - 60, periodo);

      // gerado em
      s += pdfText("F1", 8.2, cx + 10, cy + 8, "Gerado em");
      s += pdfText("F2", 9, cx + 10, cy - 6 + 18, geradoEm ? new Date(geradoEm).toLocaleString("pt-BR") : "—");

      // linha separadora
      s += pdfLine(left, y0 - 95, right, y0 - 95, 0.8);

      // footer
      s += pdfLine(left, footerY + 18, right, footerY + 18, 0.6);
      s += pdfText("F1", 8, left, footerY + 6, "META LAV • Relatório gerado automaticamente");
      s += pdfText("F1", 8, right - 90, footerY + 6, `Página ${pageNo} de ${totalPages}`);

      return s;
    }

    // monta páginas com content + imagens por página
    const pages: { content: string; xobjects: Record<string, { bytes: Uint8Array; w: number; h: number }> }[] = [];

    // ======= PAGE 1 (conteúdo principal)
    let y = top - 120;
    let body = "";

    // KPIs (4 caixas)
    const boxH = 54;
    const gap = 10;
    const totalW = right - left;
    const boxW = (totalW - gap * 3) / 4;

    function kpiBox(ix: number, label: string, value: string) {
      const x = left + ix * (boxW + gap);
      body += pdfRect(x, y - boxH, boxW, boxH, 0.8);
      body += pdfText("F1", 8.2, x + 10, y - 16, label);
      body += pdfText("F2", 12, x + 10, y - 36, value);
    }

    kpiBox(0, "Receita bruta", fmtBRL(receitaBruta));
    kpiBox(1, "Cashback", fmtBRL(cashbackValor));
    kpiBox(2, "Repasse (consumo)", fmtBRL(totalConsumo));
    kpiBox(3, "TOTAL A PAGAR", fmtBRL(totalPagar));

    y -= boxH + 18;

    function ensureSpace(need: number) {
      if (y - need < bottom + 40) {
        // sem quebra no miolo: cria nova página (raramente vai precisar)
        pages.push({
          content: body, // header/footer entra depois
          xobjects: {},
        });
        body = "";
        y = top - 120;
      }
    }

    // Seção helper
    function sectionTitle(idx: number, title: string, sub?: string) {
      ensureSpace(40);
      body += pdfText("F2", 12, left, y, `${idx}. ${title}`);
      y -= 14;
      if (sub) {
        body += pdfText("F1", 9, left, y, sub);
        y -= 10;
      }
      body += pdfLine(left, y, right, y, 0.6);
      y -= 14;
    }

    // 1. Vendas
    sectionTitle(1, "Vendas", "Vendas por máquina");

    // tabela vendas
    ensureSpace(90);
    const tX = left;
    const tW = right - left;
    const rowH = 16;

    // cabeçalho
    body += pdfRect(tX, y - rowH, tW, rowH, 0.8);
    body += pdfText("F2", 9, tX + 8, y - 12, "Máquina");
    body += pdfText("F2", 9, tX + tW * 0.55, y - 12, "Ciclos");
    body += pdfText("F2", 9, tX + tW * 0.7, y - 12, "V. unit.");
    body += pdfText("F2", 9, tX + tW * 0.86, y - 12, "Receita");
    y -= rowH;

    for (const v of vendas) {
      ensureSpace(20);
      body += pdfRect(tX, y - rowH, tW, rowH, 0.6);
      body += pdfText("F1", 9.5, tX + 8, y - 12, safeText(v.maquina) || "—");
      body += pdfText("F1", 9.5, tX + tW * 0.55, y - 12, fmtNum(v.ciclos));
      body += pdfText("F1", 9.5, tX + tW * 0.7, y - 12, fmtBRL(v.valor_unitario));
      body += pdfText("F2", 9.5, tX + tW * 0.84, y - 12, fmtBRL(v.valor_total));
      y -= rowH;
    }

    y -= 8;
    body += pdfText(
      "F1",
      9.5,
      left,
      y,
      `Receita bruta: ${fmtBRL(receitaBruta)} • Cashback: ${cashbackPct.toLocaleString("pt-BR")} % (${fmtBRL(cashbackValor)})`
    );
    y -= 18;

    // 2. Insumos
    sectionTitle(2, "Insumos", "Leitura anterior, leitura atual, consumo e repasse");

    ensureSpace(110);
    // tabela insumos
    body += pdfRect(tX, y - rowH, tW, rowH, 0.8);
    body += pdfText("F2", 9, tX + 8, y - 12, "Insumo");
    body += pdfText("F2", 9, tX + tW * 0.42, y - 12, "Anterior");
    body += pdfText("F2", 9, tX + tW * 0.56, y - 12, "Atual");
    body += pdfText("F2", 9, tX + tW * 0.68, y - 12, "Consumo");
    body += pdfText("F2", 9, tX + tW * 0.82, y - 12, "Repasse");
    y -= rowH;

    for (const c of consumos) {
      ensureSpace(20);
      body += pdfRect(tX, y - rowH, tW, rowH, 0.6);
      body += pdfText("F1", 9.5, tX + 8, y - 12, safeText(c.nome) || "—");
      body += pdfText("F1", 9.5, tX + tW * 0.42, y - 12, fmtLeitura(c.anterior));
      body += pdfText("F1", 9.5, tX + tW * 0.56, y - 12, fmtLeitura(c.atual));
      body += pdfText("F1", 9.5, tX + tW * 0.68, y - 12, fmtNum(c.consumo));
      body += pdfText("F2", 9.5, tX + tW * 0.8, y - 12, fmtBRL(c.valor_total));
      y -= rowH;
    }

    y -= 10;
    body += pdfText("F1", 9.5, left, y, `Total do repasse de consumo: ${fmtBRL(totalConsumo)}`);
    y -= 18;

    // 3. Financeiro
    sectionTitle(3, "Financeiro", "Composição do valor final");

    ensureSpace(75);
    const boxYTop = y;
    const boxHeight = 58;
    body += pdfRect(left, boxYTop - boxHeight, right - left, boxHeight, 0.8);
    body += pdfText("F1", 10, left + 10, boxYTop - 18, `Cashback: ${fmtBRL(totalCashback)}`);
    body += pdfText("F1", 10, left + 10, boxYTop - 34, `Repasse de consumo: ${fmtBRL(totalConsumo)}`);
    body += pdfText("F2", 12, left + 10, boxYTop - 52, `TOTAL A PAGAR AO CONDOMÍNIO: ${fmtBRL(totalPagar)}`);
    y -= boxHeight + 18;

    // 4. Observações
    sectionTitle(4, "Observações", "Notas do auditor / conferência");
    ensureSpace(50);
    body += pdfText("F1", 10, left, y, obs);
    y -= 20;

    // fecha page 1
    const page1XObjects: Record<string, { bytes: Uint8Array; w: number; h: number }> = {};
    if (logo) page1XObjects["Logo"] = { bytes: logo.bytes, w: logo.w, h: logo.h };

    pages.push({ content: body, xobjects: page1XObjects });

    // ======= ANEXOS: 2 por página (somente JPEG embutido)
    // layout: 2 cards empilhados (top/bottom)
    for (let i = 0; i < candidates.length; i += 2) {
      const pair = candidates.slice(i, i + 2);

      let c = "";
      let yy = top - 120;

      const xobjects: Record<string, { bytes: Uint8Array; w: number; h: number }> = {};
      if (logo) xobjects["Logo"] = { bytes: logo.bytes, w: logo.w, h: logo.h };

      // título
      c += pdfText("F2", 12, left, yy, "Anexos");
      yy -= 14;
      c += pdfText("F1", 9.5, left, yy, `Evidências do fechamento — ${periodo}`);
      yy -= 10;
      c += pdfLine(left, yy, right, yy, 0.6);
      yy -= 14;

      async function renderAnexo(slot: number, a: { tipo: string; url: string }) {
        const cardH = 300;
        const cardW = right - left;
        const cardX = left;
        const cardY = yy;

        c += pdfRect(cardX, cardY - cardH, cardW, cardH, 0.8);
        c += pdfText("F2", 10.5, cardX + 10, cardY - 18, a.tipo);

        const img = await fetchImageAsJpeg(a.url, 20000);

        if (img) {
          const name = `A${i + slot + 1}`;
          xobjects[name] = { bytes: img.bytes, w: img.w, h: img.h };

          // área imagem dentro do card
          const imgX = cardX + 10;
          const imgY = cardY - cardH + 12;
          const imgW = cardW - 20;
          const imgH = cardH - 38;

          // manter proporção “contain”
          const scale = Math.min(imgW / img.w, imgH / img.h);
          const w = img.w * scale;
          const h = img.h * scale;
          const px = imgX + (imgW - w) / 2;
          const py = imgY + (imgH - h) / 2;

          c += pdfImage(px, py, w, h, name);
        } else {
          c += pdfText("F1", 9.5, cardX + 10, cardY - 40, "Não foi possível incorporar este anexo no PDF (somente JPG).");
          c += pdfText("F1", 8.5, cardX + 10, cardY - 56, `Arquivo disponível no sistema:`);

          const u = safeText(a.url);
          const short = u.length > 90 ? u.slice(0, 87) + "..." : u;
          c += pdfText("F1", 8.2, cardX + 10, cardY - 70, short);
        }

        yy -= cardH + 18;
      }

      // eslint-disable-next-line no-await-in-loop
      if (pair[0]) await renderAnexo(0, pair[0]);
      // eslint-disable-next-line no-await-in-loop
      if (pair[1]) await renderAnexo(1, pair[1]);

      pages.push({ content: c, xobjects });
    }

    // ======= aplica header/footer em todas as páginas
    const totalPages = pages.length;
    const withHeader = pages.map((pg, idx) => {
      const hasLogo = !!pg.xobjects["Logo"];
      const h = header(idx + 1, totalPages, hasLogo);
      return { ...pg, content: h + pg.content };
    });

    const pdfBytes = buildPdf(withHeader);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="relatorio-final-${auditoriaId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad("Falha ao gerar PDF", 500, { details: e?.message ?? String(e) });
  }
}
