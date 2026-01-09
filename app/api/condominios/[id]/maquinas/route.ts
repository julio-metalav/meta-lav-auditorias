import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

type Role = "auditor" | "interno" | "gestor";

async function getUserRole(supabase: any): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (profErr) return null;
  return (prof?.role ?? null) as Role | null;
}

function roleGte(role: Role | null, min: Exclude<Role, "auditor">): boolean {
  const w: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return (w[role] ?? 0) >= (w[min] ?? 0);
}

function parseMoneyAny(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  // aceita "16,50" e "16.50" e "1.234,56"
  const cleaned = s.replace(/\s/g, "").replace(/^R\$/i, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const condominioId = params.id;

    const { data, error } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, categoria, capacidade_kg, quantidade, valor_ciclo, created_at, updated_at")
      .eq("condominio_id", condominioId)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ maquinas: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const role = await getUserRole(supabase);

    if (!roleGte(role, "interno")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const condominioId = params.id;
    const body = await req.json();
    const items = Array.isArray(body) ? body : [body];

    const payload = items.map((it: any) => ({
      condominio_id: condominioId,
      categoria: String(it.categoria ?? "").trim(),
      capacidade_kg:
        it.capacidade_kg === null || it.capacidade_kg === undefined
          ? null
          : Number(it.capacidade_kg),
      quantidade:
        it.quantidade === null || it.quantidade === undefined
          ? 0
          : Number(it.quantidade),
      // ✅ agora aceita string com vírgula
      valor_ciclo: parseMoneyAny(it.valor_ciclo),
    }));

    for (const p of payload) {
      if (!p.categoria) return NextResponse.json({ error: "categoria é obrigatória" }, { status: 400 });

      if (p.capacidade_kg !== null && Number.isNaN(p.capacidade_kg)) {
        return NextResponse.json({ error: "capacidade_kg inválida" }, { status: 400 });
      }
      if (Number.isNaN(p.quantidade) || p.quantidade < 0) {
        return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
      }
      if (Number.isNaN(p.valor_ciclo) || p.valor_ciclo < 0) {
        return NextResponse.json({ error: "valor_ciclo inválido" }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from("condominio_maquinas")
      .upsert(payload, { onConflict: "condominio_id,categoria,capacidade_kg" })
      .select("id, condominio_id, categoria, capacidade_kg, quantidade, valor_ciclo");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, maquinas: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
