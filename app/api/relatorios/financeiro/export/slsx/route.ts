export const runtime = "nodejs";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getUserAndRole } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function money(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function pct(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function formatPagamento(p: any) {
  if (!p) return "";
  const tipo = String(p.tipo ?? "").toLowerCase();
  if (tipo.includes("pix")) {
    const pix = p.pix ?? "";
    const titular = p.titular ? ` (${p.titular})` : "";
    return `PIX: ${pix}${titular}`;
  }
  const banco = p.banco ?? "";
  const ag = p.agencia ?? "";
  const cc = p.conta ?? "";
  const titular = p.titular ? ` • ${p.titular}` : "";
  return `Banco: ${banco} Ag: ${ag} Cc: ${cc}${titular}`;
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno"))
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const url = new URL(req.url);
  const mes_ref = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes_ref) return NextResponse.json({ error: "Informe mes_ref=YYYY-MM-01" }, { status: 400 });

  const origin = new URL(req.url).origin;
  const relRes = await fetch(`${origin}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  if (!relRes.ok) {
    const j = await relRes.json().catch(() => ({}));
    return NextResponse.json({ error: j?.error ?? "Falha ao gerar relatório" }, { status: 400 });
  }

  const relJson = await relRes.json();
  const rows = Array.isArray(relJson?.data) ? relJson.data : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Financeiro ${mes_ref}`);

  ws.columns = [
    { header: "Condomínio", key: "condominio", width: 32 },
    { header: "Pagamento (PIX/Banco)", key: "pagamento", width: 45 },
    { header: "Repasse (R$)", key: "repasse", width: 14 },
    { header: "Cashback (R$)", key: "cashback", width: 14 },
    { header: "Total (R$)", key: "total", width: 14 },
    { header: "Total mês anterior (R$)", key: "mes_anterior", width: 20 },
    { header: "Variação vs mês anterior (%)", key: "variacao_percent", width: 24 },
  ];

  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const pagamento = formatPagamento(r.pagamento);
    ws.addRow({
      condominio: r.condominio ?? "",
      pagamento,
      repasse: money(r.repasse),
      cashback: money(r.cashback),
      total: money(r.total),
      mes_anterior: r.mes_anterior == null ? null : money(r.mes_anterior),
      variacao_percent: r.variacao_percent == null ? null : pct(r.variacao_percent) / 100, // excel usa 0.0398 = 3.98%
    });
  }

  // formatos
  const moneyCols = ["C", "D", "E", "F"];
  for (const col of moneyCols) {
    ws.getColumn(col).numFmt = '"R$" #,##0.00';
  }
  ws.getColumn("G").numFmt = "0.00%";

  const buf = await wb.xlsx.writeBuffer();
  const filename = `relatorio_financeiro_${mes_ref}.xlsx`;

  return new NextResponse(Buffer.from(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
