export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import zlib from "zlib";

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
 * ============ PDF MINIMAL (TIPO “BANCO”) ============
 * - fontes Type1 base (Helvetica / Helvetica-Bold)
 * - texto em CP1252/WinAnsi (hex)
 * - imagem: JPEG (DCTDecode) + PNG (FlateDecode, com suporte a alpha via SMask)
 */

function toCp1252Bytes(str: string): Uint8Array {
  const map: Record<string, number> = {
    "€": 0x80,
    "‚": 0x82,
    "ƒ": 0x83,
    "„": 0x84,
    "…": 0x85,
    "†": 0x86,
    "‡": 0x87,
    "ˆ": 0x88,
    "‰": 0x89,
    "Š": 0x8a,
    "‹": 0x8b,
    "Œ": 0x8c,
    "Ž": 0x8e,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
    "–": 0x96,
    "—": 0x97,
    "˜": 0x98,
    "™": 0x99,
    "š": 0x9a,
    "›": 0x9b,
    "œ": 0x9c,
    "ž": 0x9e,
    "Ÿ": 0x9f,
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
  return `${lineW.toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S\n`;
}
function pdfImage(x: number, y: number, w: number, h: number, name: string) {
  return `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q\n`;
}

/**
 * ============ JPEG helpers ============
 */
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
 * ============ PNG decode (RGB/RGBA 8-bit, non-interlaced) ============
 */
function isPng(bytes: Uint8Array) {
  return (
    bytes?.[0] === 0x89 &&
    bytes?.[1] === 0x50 &&
    bytes?.[2] === 0x4e &&
    bytes?.[3] === 0x47 &&
    bytes?.[4] === 0x0d &&
    bytes?.[5] === 0x0a &&
    bytes?.[6] === 0x1a &&
    bytes?.[7] === 0x0a
  );
}

function readU32BE(b: Uint8Array, off: number) {
  return (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngToRgb(bytes: Uint8Array): {
  w: number;
  h: number;
  rgb: Uint8Array; // raw RGB
  alpha?: Uint8Array; // raw alpha (optional)
} | null {
  try {
    if (!isPng(bytes)) return null;

    let off = 8;
    let w = 0;
    let h = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatParts: Uint8Array[] = [];

    while (off + 8 <= bytes.length) {
      const len = readU32BE(bytes, off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      const dataOff = off + 8;
      const dataEnd = dataOff + len;
      if (dataEnd + 4 > bytes.length) break;

      if (type === "IHDR") {
        w = readU32BE(bytes, dataOff);
        h = readU32BE(bytes, dataOff + 4);
        bitDepth = bytes[dataOff + 8];
        colorType = bytes[dataOff + 9];
        interlace = bytes[dataOff + 12];
      } else if (type === "IDAT") {
        idatParts.push(bytes.slice(dataOff, dataEnd));
      } else if (type === "IEND") {
        break;
      }

      off = dataEnd + 4; // skip CRC
    }

    if (!w || !h) return null;
    if (bitDepth !== 8) return null;
    if (interlace !== 0) return null;
    if (!(colorType === 2 || colorType === 6)) return null; // RGB or RGBA

    const idat = concatBytes(idatParts);
    const inflated = zlib.inflateSync(Buffer.from(idat)); // contains filtered scanlines

    const bpp = colorType === 6 ? 4 : 3;
    const stride = w * bpp;
    const expected = (stride + 1) * h;
    if (inflated.length < expected) return null;

    const out = new Uint8Array(stride * h);
    const alpha = colorType === 6 ? new Uint8Array(w * h) : undefined;

    let inOff = 0;
    let outOff = 0;
    let aOff = 0;

    const prev = new Uint8Array(stride);

    for (let y = 0; y < h; y++) {
      const filter = inflated[inOff++];
      const row = inflated.slice(inOff, inOff + stride);
      inOff += stride;

      // unfilter in-place into cur
      const cur = new Uint8Array(stride);

      if (filter === 0) {
        cur.set(row);
      } else if (filter === 1) {
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? cur[i - bpp] : 0;
          cur[i] = (row[i] + left) & 0xff;
        }
      } else if (filter === 2) {
        for (let i = 0; i < stride; i++) {
          const up = prev[i] || 0;
          cur[i] = (row[i] + up) & 0xff;
        }
      } else if (filter === 3) {
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? cur[i - bpp] : 0;
          const up = prev[i] || 0;
          cur[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
        }
      } else if (filter === 4) {
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? cur[i - bpp] : 0;
          const up = prev[i] || 0;
          const upLeft = i >= bpp ? prev[i - bpp] : 0;
          cur[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
        }
      } else {
        return null;
      }

      // write RGB and alpha
      if (colorType === 2) {
        out.set(cur, outOff);
        outOff += stride;
      } else {
        // RGBA => store RGB contiguous and alpha separate
        for (let x = 0; x < w; x++) {
          const base = x * 4;
          out[outOff++] = cur[base];
          out[outOff++] = cur[base + 1];
          out[outOff++] = cur[base + 2];
          alpha![aOff++] = cur[base + 3];
        }
      }

      prev.set(cur);
    }

    return { w, h, rgb: out, alpha };
  } catch {
    return null;
  }
}

/**
 * ============ SUPABASE STORAGE (ROBUSTO) ============
 */
function parseSupabaseStorageUrl(u: string): { bucket: string; objectPath: string } | null {
  try {
    const url = new URL(u);
    const p = url.pathname || "";

    const idx = p.indexOf("/storage/v1/object/");
    if (idx === -1) return null;

    const rest = p.slice(idx + "/storage/v1/object/".length);
    const parts = rest.split("/").filter(Boolean);

    if (parts.length < 2) return null;

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

type PdfImage =
  | { kind: "jpeg"; bytes: Uint8Array; w: number; h: number }
  | { kind: "png"; bytes: Uint8Array; w: number; h: number; smask?: Uint8Array };

async function fetchImageAsPdfImage(url: string, timeoutMs = 20000): Promise<PdfImage | null> {
  const u = safeText(url).trim();
  if (!u) return null;

  // 1) Supabase storage primeiro (mais confiável)
  const viaStorage = await downloadViaSupabaseStorage(u);
  if (viaStorage && viaStorage.length <= 8 * 1024 * 1024) {
    if (isJpeg(viaStorage)) {
      const sz = getJpegSize(viaStorage);
      if (sz) return { kind: "jpeg", bytes: viaStorage, w: sz.w, h: sz.h };
    }
    if (isPng(viaStorage)) {
      const dec = decodePngToRgb(viaStorage);
      if (dec) {
        const rgbDef = new Uint8Array(zlib.deflateSync(Buffer.from(dec.rgb)));
        const smaskDef = dec.alpha ? new Uint8Array(zlib.deflateSync(Buffer.from(dec.alpha))) : undefined;
        return { kind: "png", bytes: rgbDef, w: dec.w, h: dec.h, smask: smaskDef };
      }
    }
  }

  // 2) Fallback fetch direto
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

    if (bytes.length > 8 * 1024 * 1024) return null;

    if (isJpeg(bytes)) {
      const sz = getJpegSize(bytes);
      if (!sz) return null;
      return { kind: "jpeg", bytes, w: sz.w, h: sz.h };
    }

    if (isPng(bytes)) {
      const dec = decodePngToRgb(bytes);
      if (!dec) return null;
      const rgbDef = new Uint8Array(zlib.deflateSync(Buffer.from(dec.rgb)));
      const smaskDef = dec.alpha ? new Uint8Array(zlib.deflateSync(Buffer.from(dec.alpha))) : undefined;
      return { kind: "png", bytes: rgbDef, w: dec.w, h: dec.h, smask: smaskDef };
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * ============ PDF builder ============
 */
function buildPdf(pages: { content: string; xobjects: Record<string, PdfImage> }[]) {
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
      if (im.kind === "jpeg") {
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
      } else {
        // PNG: FlateDecode (raw RGB), optional alpha as SMask
        let smaskId: number | null = null;

        if (im.smask && im.smask.length) {
          smaskId = newObjId();
          const sm = concatBytes([
            strBytes(
              `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.smask.length} >>\nstream\n`
            ),
            im.smask,
            strBytes(`\nendstream`),
          ]);
          objs.push({ id: smaskId, body: sm });
        }

        const imageId = newObjId();
        map[name] = imageId;

        const extra = smaskId ? ` /SMask ${smaskId} 0 R` : "";
        const img = concatBytes([
          strBytes(
            `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${extra} /Length ${im.bytes.length} >>\nstream\n`
          ),
          im.bytes,
          strBytes(`\nendstream`),
        ]);
        objs.push({ id: imageId, body: img });
      }
    }
    pageImageObjIds.push(map);
  }

  // content streams
  const contentIds: number[] = [];
  for (const pg of pages) {
    const cid = newObjId();
    const data = strBytes(pg.content);
    const stream = concatBytes([strBytes(`<< /Length ${data.length} >>\nstream\n`), data, strBytes(`\nendstream`)]);
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

    // ✅ Fallbacks robustos para nome do condomínio (era o erro de ficar em branco)
    const condominioNome =
      safeText(meta?.condominio_nome).trim() ||
      safeText(meta?.condominio).trim() ||
      safeText(data?.condominio?.nome).trim() ||
      safeText(data?.condominio_nome).trim() ||
      safeText(data?.condominioNome).trim() ||
      "—";

    const periodo = safeText(meta?.competencia) || safeText(data?.periodo) || "—";
    const geradoEm = safeText(meta?.gerado_em) || safeText(data?.gerado_em) || "";

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

    // anexos
    const anexosRaw = data?.anexos || {};
    const candidates: Array<{ tipo: string; url: string }> = [
      { tipo: "Foto do medidor de Água", url: safeText(anexosRaw?.foto_agua_url) },
      { tipo: "Foto do medidor de Energia", url: safeText(anexosRaw?.foto_energia_url) },
      { tipo: "Foto do medidor de Gás", url: safeText(anexosRaw?.foto_gas_url) },
      { tipo: "Comprovante de pagamento", url: safeText(anexosRaw?.comprovante_fechamento_url) },
    ].filter((x) => x.url);

    // logo (JPEG local do /public)
    const logoJpeg = readLogoJpegFromPublic();
    const logo: PdfImage | null = logoJpeg ? { kind: "jpeg", bytes: logoJpeg.bytes, w: logoJpeg.w, h: logoJpeg.h } : null;

    /**
     * ============ LAYOUT ============
     */
    const left = 48;
    const right = 547;
    const top = 800;
    const bottom = 60;
    const footerY = 28;

    // ✅ Header refeito: sem sobreposição entre logo/título/card
    function header(pageNo: number, totalPages: number) {
      let s = "";
      const y0 = top;

      // linha topo
      s += pdfLine(left, y0, right, y0, 1.2);

      // logo (caixa fixa)
      if (logo) {
        const targetH = 32;
        const scale = targetH / (logo.h || targetH);
        const w = (logo.w || 120) * scale;
        const h = targetH;
        s += pdfImage(left, y0 - 50, w, h, "Logo");
      }

      // títulos (sempre começam após “caixa do logo”)
      const titleX = left + 150;
      s += pdfText("F2", 16, titleX, y0 - 18, "Prestação de Contas");
      s += pdfText("F1", 10, titleX, y0 - 34, "Lavanderia Compartilhada — Relatório final");

      // card meta MAIS BAIXO (para não invadir o título)
      const cardW = 220;
const cardH = 46;
      const cx = right - cardW;
      const cyTop = y0 - 52; // topo do card (mais baixo)
      const cy = cyTop - cardH; // bottom-left y

      s += pdfRect(cx, cy, cardW, cardH, 0.8);

 
      s += pdfText("F1", 8.5, cx + 10, cyTop - 46, "Competência");
      s += pdfText("F2", 10.5, cx + 10, cyTop - 60, periodo);

      s += pdfText("F1", 8.2, cx + 10, cyTop - 74, "Gerado em");
      s += pdfText("F2", 9, cx + 70, cyTop - 74, geradoEm ? new Date(geradoEm).toLocaleString("pt-BR") : "—");

      // linha separadora abaixo do header
      const headerBottomLineY = y0 - 108;
      s += pdfLine(left, headerBottomLineY, right, headerBottomLineY, 0.8);

      // footer
      s += pdfLine(left, footerY + 18, right, footerY + 18, 0.6);
      s += pdfText("F1", 8, left, footerY + 6, "META LAV • Relatório gerado automaticamente");
      s += pdfText("F1", 8, right - 90, footerY + 6, `Página ${pageNo} de ${totalPages}`);

      return s;
    }

    // monta páginas com content + imagens por página
    const pages: { content: string; xobjects: Record<string, PdfImage> }[] = [];

    // ======= PAGE 1 (conteúdo principal)
    let y = top - 135;
    let body = "";

    // ✅ nome do condomínio GRANDE e em destaque (logo após header)
    body += pdfText("F2", 13, left, y, `Condomínio: ${condominioNome}`);
    y -= 16;
    body += pdfLine(left, y, right, y, 0.6);
    y -= 22;

    // KPIs
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
        pages.push({ content: body, xobjects: {} });
        body = "";
        y = top - 135;
      }
    }

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

    ensureSpace(90);
    const tX = left;
    const tW = right - left;
    const rowH = 16;

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
    const page1XObjects: Record<string, PdfImage> = {};
    if (logo) page1XObjects["Logo"] = logo;
    pages.push({ content: body, xobjects: page1XObjects });

    /**
     * ✅ ANEXOS: 4 POR PÁGINA (2x2)
     */
    for (let i = 0; i < candidates.length; i += 4) {
      const quad = candidates.slice(i, i + 4);

      let c = "";
      const xobjects: Record<string, PdfImage> = {};
      if (logo) xobjects["Logo"] = logo;

      // título
      let yy = top - 135;
      c += pdfText("F2", 12, left, yy, "Anexos");
      yy -= 14;
      c += pdfText("F1", 9.5, left, yy, `Evidências do fechamento — ${periodo}`);
      yy -= 10;
      c += pdfLine(left, yy, right, yy, 0.6);
      yy -= 16;

      const gridW = right - left;
      const colGap = 10;
      const rowGap = 12;
      const cardW = (gridW - colGap) / 2;
      const cardH = 320;

      async function drawCard(slot: number, a?: { tipo: string; url: string }) {
        const col = slot % 2;
        const row = Math.floor(slot / 2);

        const x = left + col * (cardW + colGap);
        const topY = yy - row * (cardH + rowGap);

        c += pdfRect(x, topY - cardH, cardW, cardH, 0.8);

        if (!a) return;

        c += pdfText("F2", 10, x + 10, topY - 18, a.tipo);

        const img = await fetchImageAsPdfImage(a.url, 25000);

        if (img) {
          const name = `IMG_${i + slot + 1}`;
          xobjects[name] = img;

          // área útil
          const imgX = x + 10;
          const imgY = topY - cardH + 12;
          const imgW = cardW - 20;
          const imgH = cardH - 38;

          // contain
          const scale = Math.min(imgW / img.w, imgH / img.h);
          const w = img.w * scale;
          const h = img.h * scale;
          const px = imgX + (imgW - w) / 2;
          const py = imgY + (imgH - h) / 2;

          c += pdfImage(px, py, w, h, name);
        } else {
          c += pdfText("F1", 9.5, x + 10, topY - 40, "Não foi possível incorporar este anexo no PDF.");
          const u = safeText(a.url);
          const short = u.length > 95 ? u.slice(0, 92) + "..." : u;
          c += pdfText("F1", 8.5, x + 10, topY - 56, short);
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await drawCard(0, quad[0]);
      // eslint-disable-next-line no-await-in-loop
      await drawCard(1, quad[1]);
      // eslint-disable-next-line no-await-in-loop
      await drawCard(2, quad[2]);
      // eslint-disable-next-line no-await-in-loop
      await drawCard(3, quad[3]);

      pages.push({ content: c, xobjects });
    }

    // aplica header/footer
    const totalPages = pages.length;
    const withHeader = pages.map((pg, idx) => {
      const h = header(idx + 1, totalPages);
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
