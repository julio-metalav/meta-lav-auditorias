import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Linha = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number;
  ciclos: number;
};

async function getRole(supabase: ReturnType<typeof supabaseServer>, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.role ?? null) as string | null;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const auditoriaId = ctx.params.id;

    // pega a auditoria (pra descobrir o condominio_id)
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id, condominio_id")
      .eq("id", auditoriaId)
      .maybeSingle();

    if (audErr) throw audErr;
    if (!aud) return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });

    // máquinas do condomínio
    const { data: maquinas, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("categoria, capacidade_kg, quantidade, valor_ciclo, ativo")
      .eq("condominio_id", aud.condominio_id)
      .eq("ativo", true)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (maqErr) throw maqErr;

    // ciclos já lançados para essa auditoria
    const { data: ciclos, error: cicErr } = await supabase
      .from("auditoria_ciclos")
      .select("categoria, capacidade_kg, ciclos")
      .eq("auditoria_id", auditoriaId);

    if (cicErr) throw cicErr;

    return NextResponse.json({
      condominio_id: aud.condominio_id,
      maquinas: maquinas ?? [],
      ciclos: ciclos ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar ciclos" },
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

    const role = await getRole(supabase, auth.user.id);
    if (role !== "interno" && role !== "gestor") {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const auditoriaId = ctx.params.id;
    const body = await req.json();

    const linhas: Linha[] = Array.isArray(body?.linhas) ? body.linhas : [];
    if (!linhas.length) {
      return NextResponse.json({ error: "Nenhuma linha enviada." }, { status: 400 });
    }

    const payload = linhas.map((l) => ({
      auditoria_id: auditoriaId,
      categoria: l.categoria,
      capacidade_kg: Number(l.capacidade_kg),
      ciclos: Number(l.ciclos ?? 0),
    }));

    const { error } = await supabase
      .from("auditoria_ciclos")
      .upsert(payload, { onConflict: "auditoria_id,categoria,capacidade_kg" });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao salvar ciclos" },
      { status: 500 }
    );
  }
}

