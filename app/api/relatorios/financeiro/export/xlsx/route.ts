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

function formatPagamento(p: any) {
  if (!p) return "";
  const cpf = p.cpf_cnpj ? ` • CNPJ/CPF: ${p.cpf_cnpj}` : "";

  // prioridade: PIX
  if (p.pix) {
    const titular = p.titular ? ` • ${p.titular}` : "";
    return `PIX: ${p.pix}${titular}${cpf}`;
  }

  const banco = p.banco ? `Banco (${p.banco})` : "";
  const ag = p.agencia ? `Ag: ${p.agencia}` : "";
  const cc = p.conta ? `Conta: ${p.conta}` : "";
  const tipo = p.tipo_conta ? ` (${p.tipo_conta})` : "";
  const titular = p.titular ? ` • ${p.titular}` : "";

  const parts = [banco, ag, cc].filter(Boolean).join(" • ");
  return parts ? `${parts}${tipo}${titular}${cpf}` : "";
}

export async function GET(req: Request) {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte((role ?? null) as any, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

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
    return NextResponse.json({ error: (j as any)?.error ?? "Falha ao gerar relatório" }, { status: 400 });
  }

  const relJson = await relRes.json().catch(() => ({}));
  const rows = Array.isArray((relJson as any)?.data) ? (relJson as any).data : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Financeiro ${mes_ref}`);

  ws.columns = [
    { header: "Condomínio", key: "condominio", width: 32 },
    { header: "Pagamento (PIX/Banco)", key: "pagamento", width: 60 },
    { header: "Repasse (R$)", key: "repasse", width: 14 },
    { header: "Cashback (R$)", key: "cashback", width: 14 },
    { header: "Total (R$)", key: "total", width: 14 },
    { header: "Variação vs mês anterior (%)", key: "variacao_percent", width: 26 },
  ];

  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow({
      condominio: r?.condominio ?? "",
      pagamento: formatPagamento(r?.pagamento),
      repasse: money(r?.repasse),
      cashback: money(r?.cashback),
      total: money(r?.total),
      variacao_percent: r?.variacao_percent == null ? null : Number(r.variacao_percent) / 100,
    });
  }

  // formatos
  const moneyCols = ["C", "D", "E"];
  for (const col of moneyCols) ws.getColumn(col).numFmt = '"R$" #,##0.00';
  ws.getColumn("F").numFmt = "0.00%";

  const buf = await wb.xlsx.writeBuffer();
  const filename = `relatorio_financeiro_${mes_ref}.xlsx`;

  // usa Response (melhor compatibilidade de types no Next)
  return new Response(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
