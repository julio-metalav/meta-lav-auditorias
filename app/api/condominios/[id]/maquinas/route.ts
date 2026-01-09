import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const condominioId = ctx.params.id;

    const { data, error } = await supabase
      .from("condominio_maquinas")
      .select("id, categoria, capacidade_kg, quantidade, valor_ciclo, ativo")
      .eq("condominio_id", condominioId)
      .eq("ativo", true)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar máquinas" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    // role check (interno/gestor)
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (profErr) throw profErr;

    if (!prof?.role || (prof.role !== "interno" && prof.role !== "gestor")) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const condominioId = ctx.params.id;
    const body = await req.json();

    const maquinas = Array.isArray(body?.maquinas) ? body.maquinas : null;
    if (!maquinas) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    // upsert por (condominio_id, categoria, capacidade_kg)
    const payload = maquinas.map((m: any) => ({
      condominio_id: condominioId,
      categoria: m.categoria,
      capacidade_kg: Number(m.capacidade_kg),
      quantidade: Number(m.quantidade ?? 0),
      valor_ciclo: Number(m.valor_ciclo ?? 0),
      ativo: m.ativo ?? true,
    }));

    const { error } = await supabase
      .from("condominio_maquinas")
      .upsert(payload, { onConflict: "condominio_id,categoria,capacidade_kg" });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao salvar máquinas" },
      { status: 500 }
    );
  }
}
