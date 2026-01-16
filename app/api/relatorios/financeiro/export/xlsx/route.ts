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

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

export async function GET(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as any, "interno")) return bad("Sem permissão", 403);

    const url = new URL(req.url);
    const mes_ref = url.searchParams.get("mes_ref") || "";
    if (!mes_ref) return bad("Parâmetro mes_ref obrigatório (YYYY-MM-01)", 400);

    const baseUrl = getBaseUrlFromReq(req);
    if (!baseUrl) return bad("Não foi possível determinar baseUrl", 500);

    const cookie = req.headers.get("cookie") || "";

    // ✅ Fonte da verdade: JSON base
    const r = await fetch(
      `${baseUrl}/api/relatorios/financeiro?mes_ref=${encodeURIComponent(mes_ref)}`,
      {
        cache: "no-store",
        headers: { cookie },
      }
    );

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return bad(`Falha ao gerar base do relatório (${r.status}). ${t}`, 500);
    }

    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.rows) ? j.rows : [];

    // ✅ Monta XLSX
    const wb = new ExcelJS.Workbook();
    wb.creator = "Meta-Lav";
    wb.created = new Date();

    const ws = wb.addWorksheet("Financeiro");

    ws.columns = [
      { header: "Condomínio", key: "condominio_nome", width: 35 },
      { header: "Pagamento (PIX/Banco)", key: "pagamento_texto", width: 45 },
      { header: "Repasse (R$)", key: "repasse", width: 15 },
      { header: "Cashback (R$)", key: "cashback", width: 15 },
      { header: "Total (R$)", key: "total", width: 15 },
      { header: "Variação vs mês anterior (%)", key: "variacao_percent", width: 22 },
    ];

    ws.getRow(1).font = { bold: true };

    for (const row of rows) {
      ws.addRow({
        condominio_nome: String(row?.condominio_nome ?? ""),
        pagamento_texto: String(row?.pagamento_texto ?? ""),
        repasse: Number(row?.repasse ?? 0),
        cashback: Number(row?.cashback ?? 0),
        total: Number(row?.total ?? 0),
        variacao_percent: Number(row?.variacao_percent ?? 0),
      });
    }

    // Formatos
    ws.getColumn("repasse").numFmt = '"R$" #,##0.00';
    ws.getColumn("cashback").numFmt = '"R$" #,##0.00';
    ws.getColumn("total").numFmt = '"R$" #,##0.00';
    ws.getColumn("variacao_percent").numFmt = "0.00%";

    const buf = await wb.xlsx.writeBuffer();

    return new Response(buf as any, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="relatorio_financeiro_${mes_ref}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
