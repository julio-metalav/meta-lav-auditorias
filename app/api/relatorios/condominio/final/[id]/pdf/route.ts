export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import path from "node:path";

import { getUserAndRole, roleGte } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeText(v: any) {
  return String(v ?? "");
}
function safeNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type ImgObj = { data: Buffer; mime: string }; // mime: image/png | image/jpeg
type AnexoBuilt = { tipo: string; dataUri?: string; ok: boolean };

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : "—";
}
function fmtLeitura(v: any) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : "—";
}
function fmtDateTime(v?: string) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return String(v);
  }
}

function getOrigin(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

async function fetchReportJson(req: NextRequest, origin: string, auditoriaId: string) {
  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(`${origin}/api/relatorios/condominio/final/${auditoriaId}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", cookie },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error ? safeText(json.error) : "Falha ao obter dados do relatório.";
    throw new Error(msg);
  }
  return json?.data ?? null;
}

/** lê logo do /public (definitivo; zero HTTP) */
async function loadLogoDataUri(): Promise<string | null> {
  const candidates = ["logo.png", "logo.jpg", "logo.jpeg", "logo Meta Lav.jpg", "logo Meta Lav.png"];

  for (const name of candidates) {
    try {
      const p = path.join(process.cwd(), "public", name);
      const buf = await fs.readFile(p);
      if (!buf || buf.length === 0) continue;

      const lower = name.toLowerCase();
      const mime =
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      // tenta proximo
    }
  }
  return null;
}

async function fetchImageAsDataUri(url: string, timeoutMs = 25000): Promise<string | null> {
  const u = safeText(url).trim();
  if (!u) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(u, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const mime = ct.includes("jpeg") || ct.includes("jpg") ? "image/jpeg" : "image/png";

    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);

    // limite de segurança (ajustável)
    if (buf.length > 10 * 1024 * 1024) return null;

    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** monta HTML premium (nivel banco) */
function buildHtml(args: {
  logoUri: string | null;
  condominioNome: string;
  competencia: string;
  geradoEm: string;
  vendas: Array<{ maquina: string; ciclos: number; valor_unitario: number; valor_total: number }>;
  receitaBruta: number;
  cashbackPercent: number;
  cashbackValor: number;
  consumos: Array<{
    nome: string;
    anterior: number | null;
    atual: number | null;
    consumo: number;
    valor_total: number;
  }>;
  totalConsumo: number;
  totalCashback: number;
  totalPagar: number;
  observacoes: string;
  anexos: AnexoBuilt[];
}) {
  const {
    logoUri,
    condominioNome,
    competencia,
    geradoEm,
    vendas,
    receitaBruta,
    cashbackPercent,
    cashbackValor,
    consumos,
    totalConsumo,
    totalCashback,
    totalPagar,
    observacoes,
    anexos,
  } = args;

  const obs = (observacoes || "").trim();
  const obsCompact = obs ? (obs.length > 350 ? obs.slice(0, 347) + "…" : obs) : "—";

  const vendasRows = vendas
    .map(
      (v, i) => `
      <tr class="${i % 2 ? "alt" : ""}">
        <td class="l">${escapeHtml(v.maquina || "—")}</td>
        <td class="r">${fmtNum(v.ciclos)}</td>
        <td class="r">${brl(v.valor_unitario)}</td>
        <td class="r strong">${brl(v.valor_total)}</td>
      </tr>`
    )
    .join("");

  const consumoRows = consumos
    .map(
      (c, i) => `
      <tr class="${i % 2 ? "alt" : ""}">
        <td class="l">${escapeHtml(c.nome || "—")}</td>
        <td class="r">${fmtLeitura(c.anterior)}</td>
        <td class="r">${fmtLeitura(c.atual)}</td>
        <td class="r">${fmtNum(c.consumo)}</td>
        <td class="r strong">${brl(c.valor_total)}</td>
      </tr>`
    )
    .join("");

  // anexos: 2 por pagina (grid 2 colunas)
  const anexoCards = anexos
    .map((a) => {
      if (!a.ok || !a.dataUri) {
        return `
        <div class="anexo-card">
          <div class="anexo-title">${escapeHtml(a.tipo)}</div>
          <div class="anexo-missing">Não foi possível incorporar este anexo no PDF.</div>
        </div>`;
      }
      return `
      <div class="anexo-card">
        <div class="anexo-title">${escapeHtml(a.tipo)}</div>
        <img class="anexo-img" src="${a.dataUri}" />
      </div>`;
    })
    .join("");

  // força anexos em páginas com 2 cards: se vier ímpar, completa com slot vazio (estético)
  const anexoCount = anexos.length;
  const needsSlot = anexoCount % 2 === 1;
  const slot = needsSlot
    ? `<div class="anexo-card"><div class="anexo-title"> </div></div>`
    : "";

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="META LAV" />`
    : `<div class="logo-fallback">META LAV</div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Prestação de Contas - ${escapeHtml(condominioNome)}</title>
<style>
  :root{
    --ink:#0B1F35; --muted:#5B6B7E; --line:#D9E2EC; --bg:#F4F7FB; --white:#fff;
    --brand:#0B4A78; --soft:#EEF5FB; --head:#F1F5F9;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0; background:var(--bg); color:var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "Helvetica Neue", Helvetica, sans-serif;
  }
  .page{
    width: 210mm;
    min-height: 297mm;
    padding: 16mm 14mm 14mm 14mm;
    margin: 0 auto;
    background: var(--bg);
  }
  .topbar{ height:6px; background:var(--brand); border-radius:6px; margin-bottom:14px; }

  .header{
    display:flex; justify-content:space-between; align-items:flex-start; gap:16px;
    margin-bottom:10px;
  }
  .brand{
    display:flex; align-items:center; gap:12px; max-width: 120mm;
  }
  .logo{ width: 46mm; height: 16mm; object-fit:contain; }
  .logo-fallback{ font-weight:800; font-size:18px; color:var(--brand); padding-top:4px; }
  .titles .h1{ font-size:22px; font-weight:800; letter-spacing:.2px; }
  .titles .sub{ margin-top:2px; font-size:12px; color:var(--muted); }
  .badge{
    margin-top:10px; display:inline-block; padding:6px 10px;
    border-radius:999px; background:var(--soft); border:1px solid #CFE2F1;
    font-size:10px; font-weight:800; color:var(--brand);
  }
  .meta{
    width: 74mm;
    background:var(--white); border:1px solid var(--line); border-radius:10px;
    padding:10px 10px;
  }
  .meta .lbl{ font-size:10px; color:var(--muted); }
  .meta .val{ margin-top:2px; font-size:13px; font-weight:800; }
  .divider{ height:1px; background:var(--line); margin:10px 0; }

  .hr{ height:1px; background:var(--line); margin: 10px 0 12px; }

  /* KPI row */
  .kpis{ display:flex; gap:10px; margin-bottom:12px; }
  .kpi{
    flex:1; background:var(--white); border:1px solid var(--line); border-radius:10px; padding:10px;
  }
  .kpi .lbl{ font-size:10px; color:var(--muted); }
  .kpi .val{ margin-top:6px; font-size:16px; font-weight:900; }
  .kpi .hint{ margin-top:4px; font-size:10px; color:var(--muted); }
  .kpi-total{
    flex:1.2; background:var(--brand); border-radius:10px; padding:10px;
    color:#fff;
  }
  .kpi-total .lbl{ font-size:10px; font-weight:800; color:#DCEAF6; }
  .kpi-total .val{ margin-top:6px; font-size:18px; font-weight:900; }

  .card{
    background:var(--white); border:1px solid var(--line); border-radius:10px;
    padding:12px; margin-bottom:12px;
    page-break-inside: avoid;
  }
  .section-title{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .index{
    width:22px; height:22px; border-radius:6px; background:var(--soft);
    border:1px solid #CFE2F1; color:var(--brand);
    display:flex; align-items:center; justify-content:center;
    font-weight:900; font-size:12px;
  }
  .stext .h{ font-size:14px; font-weight:900; }
  .stext .s{ margin-top:2px; font-size:11px; color:var(--muted); }

  table{ width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border-radius:10px; border:1px solid var(--line); }
  thead th{
    background:var(--head);
    border-bottom:1px solid var(--line);
    padding:10px 10px;
    font-size:11px; text-transform:none; letter-spacing:.2px;
    text-align:left;
  }
  tbody td{
    padding:10px 10px;
    border-bottom:1px solid var(--line);
    font-size:12px;
  }
  tbody tr.alt td{ background:#FBFDFF; }
  tbody tr:last-child td{ border-bottom:none; }
  .l{ text-align:left; }
  .r{ text-align:right; }
  .strong{ font-weight:900; }

  .note{ margin-top:10px; font-size:12px; }
  .finance-box{
    margin-top:10px; background:#F8FAFC; border:1px solid var(--line); border-radius:10px; padding:10px;
  }
  .obs{ font-size:12px; line-height:1.35; color:var(--ink); }

  /* Footer */
  .footer{
    margin-top: 10mm;
    padding-top:6px; border-top:1px solid var(--line);
    display:flex; justify-content:space-between; color:var(--muted);
    font-size:10px;
  }

  /* Anexos */
  .page-break{ page-break-before: always; }
  .anexo-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
  .anexo-card{
    background:var(--white); border:1px solid var(--line); border-radius:10px; padding:8px;
    page-break-inside: avoid;
    min-height: 150mm;
  }
  .anexo-title{ font-size:12px; font-weight:900; margin-bottom:8px; }
  .anexo-img{
    width:100%;
    height: 138mm;
    object-fit: cover;
    border-radius:8px;
    border: 1px solid #E6EEF6;
  }
  .anexo-missing{ color:var(--muted); font-size:11px; padding:12px; }

  @page { size: A4; margin: 0; }
</style>
</head>
<body>

  <!-- PAGINA 1 -->
  <div class="page">
    <div class="topbar"></div>

    <div class="header">
      <div class="brand">
        ${logoHtml}
        <div class="titles">
          <div class="h1">Prestação de Contas</div>
          <div class="sub">Lavanderia Compartilhada — Relatório final</div>
          <div class="badge">DOCUMENTO OFICIAL</div>
        </div>
      </div>

      <div class="meta">
        <div class="lbl">Condomínio</div>
        <div class="val">${escapeHtml(condominioNome || "—")}</div>

        <div class="divider"></div>

        <div class="lbl">Competência</div>
        <div class="val">${escapeHtml(competencia || "—")}</div>

        <div class="divider"></div>

        <div class="lbl">Gerado em</div>
        <div class="val" style="font-size:12px">${escapeHtml(fmtDateTime(geradoEm))}</div>
      </div>
    </div>

    <div class="hr"></div>

    <!-- Resumo executivo -->
    <div class="kpis">
      <div class="kpi">
        <div class="lbl">Receita bruta</div>
        <div class="val">${brl(receitaBruta)}</div>
      </div>

      <div class="kpi">
        <div class="lbl">Cashback</div>
        <div class="val">${brl(cashbackValor)}</div>
        <div class="hint">${fmtNum(cashbackPercent)}% sobre receita</div>
      </div>

      <div class="kpi">
        <div class="lbl">Repasse de consumo</div>
        <div class="val">${brl(totalConsumo)}</div>
      </div>

      <div class="kpi-total">
        <div class="lbl">TOTAL A PAGAR AO CONDOMÍNIO</div>
        <div class="val">${brl(totalPagar)}</div>
      </div>
    </div>

    <!-- 1 Vendas -->
    <div class="card">
      <div class="section-title">
        <div class="index">1</div>
        <div class="stext">
          <div class="h">Vendas</div>
          <div class="s">Vendas por máquina</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:40%">Máquina</th>
            <th style="width:15%; text-align:right">Ciclos</th>
            <th style="width:20%; text-align:right">V. unit.</th>
            <th style="width:25%; text-align:right">Receita</th>
          </tr>
        </thead>
        <tbody>
          ${vendasRows || ""}
        </tbody>
      </table>

      <div class="note">
        Receita bruta: <b>${brl(receitaBruta)}</b> · Cashback: <b>${fmtNum(cashbackPercent)}%</b> (<b>${brl(cashbackValor)}</b>)
      </div>
    </div>

    <!-- 2 Insumos -->
    <div class="card">
      <div class="section-title">
        <div class="index">2</div>
        <div class="stext">
          <div class="h">Insumos</div>
          <div class="s">Leitura anterior, leitura atual, consumo e repasse</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:26%">Insumo</th>
            <th style="width:18%; text-align:right">Anterior</th>
            <th style="width:18%; text-align:right">Atual</th>
            <th style="width:14%; text-align:right">Consumo</th>
            <th style="width:24%; text-align:right">Repasse</th>
          </tr>
        </thead>
        <tbody>
          ${consumoRows || ""}
        </tbody>
      </table>

      <div class="note">
        Total do repasse de consumo: <b>${brl(totalConsumo)}</b>
      </div>
    </div>

    <!-- 3 Financeiro -->
    <div class="card">
      <div class="section-title">
        <div class="index">3</div>
        <div class="stext">
          <div class="h">Financeiro</div>
          <div class="s">Composição do valor final</div>
        </div>
      </div>

      <div class="finance-box">
        Cashback: <b>${brl(totalCashback)}</b><br/>
        Repasse de consumo: <b>${brl(totalConsumo)}</b><br/><br/>
        Total a pagar ao condomínio: <b style="font-size:14px">${brl(totalPagar)}</b>
      </div>
    </div>

    <!-- 4 Observações -->
    <div class="card">
      <div class="section-title">
        <div class="index">4</div>
        <div class="stext">
          <div class="h">Observações</div>
          <div class="s">Notas do auditor / conferência</div>
        </div>
      </div>
      <div class="obs">${escapeHtml(obsCompact)}</div>
    </div>

    <div class="footer">
      <div>META LAV — Tecnologia em Lavanderia</div>
      <div>Competência ${escapeHtml(competencia || "—")}</div>
    </div>
  </div>

  <!-- ANEXOS -->
  <div class="page-break"></div>
  <div class="page">
    <div class="topbar"></div>

    <div class="header">
      <div class="brand">
        ${logoHtml}
        <div class="titles">
          <div class="h1">Anexos</div>
          <div class="sub">Evidências do fechamento — ${escapeHtml(competencia || "—")}</div>
          <div class="badge">EVIDÊNCIAS</div>
        </div>
      </div>

      <div class="meta">
        <div class="lbl">Condomínio</div>
        <div class="val">${escapeHtml(condominioNome || "—")}</div>

        <div class="divider"></div>

        <div class="lbl">Competência</div>
        <div class="val">${escapeHtml(competencia || "—")}</div>
      </div>
    </div>

    <div class="hr"></div>

    <div class="anexo-grid">
      ${anexoCards}${slot}
    </div>

    <div class="footer">
      <div>META LAV — Tecnologia em Lavanderia</div>
      <div>Competência ${escapeHtml(competencia || "—")}</div>
    </div>
  </div>

</body>
</html>`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getUserAndRole();
  if (!user) return bad("Não autenticado", 401);
  if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

  const auditoriaId = safeText(params?.id).trim();
  if (!auditoriaId) return bad("ID inválido", 400);

  const origin = getOrigin(req);

  try {
    const data = await fetchReportJson(req, origin, auditoriaId);
    if (!data) return bad("Relatório sem dados", 404);

    const condominioNome = safeText(data?.meta?.condominio_nome);
    const competencia = safeText(data?.meta?.competencia);
    const geradoEm = safeText(data?.meta?.gerado_em || "");

    const vendas = Array.isArray(data?.vendas_por_maquina?.itens)
      ? data.vendas_por_maquina.itens.map((v: any) => ({
          maquina: safeText(v?.maquina),
          ciclos: safeNumber(v?.ciclos),
          valor_unitario: safeNumber(v?.valor_unitario),
          valor_total: safeNumber(v?.valor_total),
        }))
      : [];

    const receitaBruta = safeNumber(data?.vendas_por_maquina?.receita_bruta_total);
    const cashbackPercent = safeNumber(data?.vendas_por_maquina?.cashback_percent);
    const cashbackValor = safeNumber(data?.vendas_por_maquina?.valor_cashback);

    const consumos = Array.isArray(data?.consumo_insumos?.itens)
      ? data.consumo_insumos.itens.map((c: any) => ({
          nome: safeText(c?.insumo),
          anterior: c?.leitura_anterior ?? null,
          atual: c?.leitura_atual ?? null,
          consumo: safeNumber(c?.consumo),
          valor_total: safeNumber(c?.valor_total),
        }))
      : [];

    const totalConsumo = safeNumber(data?.consumo_insumos?.total_repasse_consumo);
    const totalCashback = safeNumber(data?.totalizacao_final?.cashback);
    const totalPagar = safeNumber(data?.totalizacao_final?.total_a_pagar_condominio);

    const observacoes = safeText(data?.observacoes || "").trim();

    // logo (do /public)
    const logoUri = await loadLogoDataUri();

    // anexos (converte para dataURI pra não depender de rede durante render)
    const anexosRaw = data?.anexos || {};
    const candidates: Array<{ tipo: string; url: string }> = [
      { tipo: "Foto do medidor de Água", url: safeText(anexosRaw?.foto_agua_url) },
      { tipo: "Foto do medidor de Energia", url: safeText(anexosRaw?.foto_energia_url) },
      { tipo: "Foto do medidor de Gás", url: safeText(anexosRaw?.foto_gas_url) },
      { tipo: "Comprovante de pagamento", url: safeText(anexosRaw?.comprovante_fechamento_url) },
    ].filter((x) => x.url);

    const anexos: AnexoBuilt[] = [];
    for (const c of candidates) {
      const dataUri = await fetchImageAsDataUri(c.url);
      anexos.push({ tipo: c.tipo, dataUri: dataUri ?? undefined, ok: Boolean(dataUri) });
    }

    const html = buildHtml({
      logoUri,
      condominioNome,
      competencia,
      geradoEm,
      vendas,
      receitaBruta,
      cashbackPercent,
      cashbackValor,
      consumos,
      totalConsumo,
      totalCashback,
      totalPagar,
      observacoes,
      anexos,
    });

    // Puppeteer + chromium serverless
    const executablePath = await chromium.executablePath();

    const browser = await puppeteer.launch({
  args: chromium.args,
  executablePath,
  headless: chromium.headless,
});


    try {
      const page = await browser.newPage();

      // render HTML
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });

      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="relatorio-final-${auditoriaId}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    return bad(e?.message ? safeText(e.message) : "Erro ao gerar PDF", 500);
  }
}
