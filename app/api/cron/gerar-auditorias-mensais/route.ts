import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // 1) LER SECRET DO AMBIENTE
    const CRON_SECRET = process.env.CRON_SECRET;
    if (!CRON_SECRET) {
      return NextResponse.json(
        { error: "CRON_SECRET não configurado no ambiente" },
        { status: 500 }
      );
    }

    // 2) LER HEADER AUTHORIZATION
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ")
      ? auth.replace("Bearer ", "").trim()
      : "";

    if (!token || token !== CRON_SECRET) {
      return NextResponse.json(
        { error: "Não autenticado" },
        { status: 401 }
      );
    }

    // 3) DATA BASE (mês atual)
    const now = new Date();
    const ano = now.getFullYear();
    const mes = String(now.getMonth() + 1).padStart(2, "0");
    const mesRef = `${ano}-${mes}-01`;

    // 4) BUSCAR CONDOMÍNIOS ATIVOS
    const { data: condos, error: e1 } = await supabaseAdmin()
      .from("condominios")
      .select("id")
      .eq("ativo", true);

    if (e1) {
      return NextResponse.json(
        { error: e1.message },
        { status: 500 }
      );
    }

    if (!condos || condos.length === 0) {
      return NextResponse.json(
        { ok: true, criadas: 0, motivo: "Nenhum condomínio ativo" },
        { status: 200 }
      );
    }

    // 5) GERAR AUDITORIAS (IDEMPOTENTE)
    const rows = condos.map((c) => ({
      condominio_id: c.id,
      mes_ref: mesRef,
      status: "aberta",
    }));

    const { error: e2 } = await supabaseAdmin()
      .from("auditorias")
      .upsert(rows, {
        onConflict: "condominio_id,mes_ref",
      });

    if (e2) {
      return NextResponse.json(
        { error: e2.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, mes: mesRef, criadas: rows.length },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
