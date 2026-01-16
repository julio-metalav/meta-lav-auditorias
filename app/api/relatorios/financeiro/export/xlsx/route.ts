export const runtime = "nodejs";

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

function pct01(n: any) {
  // Excel % usa 0.0398 para 3.98%
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v / 100;
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno")) {
    return Response.json({ error: "Sem permissão" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mes_ref = (url.searchParams.get("mes_ref") ?? "").trim();
  if (!mes_ref) return Response.json({ error: "Informe mes_ref=YYYY-MM-01" }, { status: 400 });

  const origin = new URL(req.url).origin;
  const relRes = await fetch(`${origin}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  if (!relRes.ok) {
    const j = await relRes.json().catch(() => ({}));
    return Response.json({ error: (j as any)?.error ?? "Falha ao gerar relatório" }, { status: 400 });
  }

  const relJson: any = await relRes.json();
  const rows = Array.isArray(relJson?.data) ? relJson.data : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Financeiro ${mes_ref}`);

  ws.columns = [
    { header: "Condomínio", key: "condominio", width: 34 },
    { header: "Pagamento (PIX/Banco)", key: "pagamento", width: 55 },
    { header: "Repasse (R$)", key: "repasse", width: 14 },
    { header: "Cashback (R$)", key: "cashback", width: 14 },
    { header: "Total (R$)", key: "total", width: 14 },
    { header: "Variação vs mês anterior (%)", key: "variacao_percent", width: 26 },
  ];

  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow({
      condominio: r.condominio ?? "",
      pagamento: r.pagamento_texto ?? "",
      repasse: money(r.repasse),
      cashback: money(r.cashback),
      total: money(r.total),
      variacao_percent: r.variacao_percent == null ? null : pct01(r.variacao_percent),
    });
  }

  // formatos
  for (const col of ["C", "D", "E"]) ws.getColumn(col).numFmt = '"R$" #,##0.00';
  ws.getColumn("F").numFmt = "0.00%";

  // buffer
  const buf = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(buf);
  const filename = `relatorio_financeiro_${mes_ref}.xlsx`;

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
