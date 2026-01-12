import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type Role = "auditor" | "interno" | "gestor";

function roleRank(role: Role | null) {
  const w: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return 0;
  return w[role] ?? 0;
}

function roleGte(role: Role | null, min: Role): boolean {
  return roleRank(role) >= roleRank(min);
}

async function getUserRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error: profErr } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if (profErr) return null;

  return (prof?.role ?? null) as Role | null;
}

function normCategoria(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora" || s === "secadora") return s;
  return "";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function tagPrefix(cat: string) {
  if (cat === "lavadora") return "LAV";
  if (cat === "secadora") return "SEC";
  return "MAQ";
}

function toNonNegInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i;
}

/**
 * Gera a lista "explodida" de máquinas por quantidade:
 * condominio_maquinas: (categoria, capacidade_kg, quantidade)
 * -> itens individuais com maquina_tag: LAV-10-01, LAV-10-02, SEC-15-01 ...
 */
function expandMaquinas(maquinas: any[]) {
  const items: { maquina_tag: string; tipo: string; meta: any }[] = [];

  // ordena pra tags serem estáveis
  const sorted = [...(maquinas ?? [])].sort((a, b) => {
    const ca = String(a?.categoria ?? "");
    const cb = String(b?.categoria ?? "");
    if (ca !== cb) return ca.localeCompare(cb);
    const ka = Number(a?.capacidade_kg ?? 0);
    const kb = Number(b?.capacidade_kg ?? 0);
    if (ka !== kb) return ka - kb;
    return 0;
  });

  for (const m of sorted) {
    const cat = normCategoria(m?.categoria);
    const cap = Number(m?.capacidade_kg ?? 0);
    const qtd = Math.max(0, Math.trunc(Number(m?.quantidade ?? 0)));

    if (!cat || !Number.isFinite(cap) || qtd <= 0) continue;

    const prefix = tagPrefix(cat);
    const tipo = `${cat} ${cap}kg`;

    for (let i = 1; i <= qtd; i++) {
      const maquina_tag = `${prefix}-${cap}-${pad2(i)}`;
      items.push({ maquina_tag, tipo, meta: m });
    }
  }

  return items;
}

/**
 * GET /api/auditorias/:id/ciclos
 * Retorna SEMPRE a lista completa de máquinas (explodida) + ciclos já lançados (se existirem)
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const role = await getUserRole(supabase);
    if (!roleGte(role, "auditor")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // auditoria
    const { data: aud, error: audErr } = await supabase
      .from("auditorias")
      .select("id, condominio_id, mes_ref, status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });
    }

    const condominioId = String((aud as any).condominio_id);

    // maquinas do condomínio (cat + capacidade + qtd + valor_ciclo etc)
    const { data: maquinas, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, categoria, capacidade_kg, quantidade, valor_ciclo, ativo")
      .eq("condominio_id", condominioId)
      .eq("ativo", true)
      .order("categoria", { ascending: true })
      .order("capacidade_kg", { ascending: true });

    if (maqErr) return NextResponse.json({ error: maqErr.message }, { status: 400 });

    const expanded = expandMaquinas(maquinas ?? []);

    // itens já lançados no fechamento (por máquina_tag)
    const { data: itensSaved, error: itErr } = await supabase
      .from("auditoria_fechamento_itens")
      .select("id, auditoria_id, maquina_tag, tipo, ciclos")
      .eq("auditoria_id", auditoriaId);

    if (itErr) return NextResponse.json({ error: itErr.message }, { status: 400 });

    const map = new Map<string, any>();
    for (const r of itensSaved ?? []) map.set(String(r.maquina_tag), r);

    const itens = expanded.map((x) => {
      const saved = map.get(x.maquina_tag);
      return {
        id: saved?.id ?? null,
        auditoria_id: auditoriaId,
        maquina_tag: x.maquina_tag,
        tipo: saved?.tipo ?? x.tipo,
        ciclos: Number(saved?.ciclos ?? 0),
      };
    });

    return NextResponse.json({
      ok: true,
      auditoria: { ...(aud as any), ano_mes: (aud as any).mes_ref ?? null }, // compat
      condominio_id: condominioId,
      maquinas: maquinas ?? [],
      itens,
      data: itens, // compat com telas antigas que leem data
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}

/**
 * POST /api/auditorias/:id/ciclos
 * Somente interno/gestor.
 * Body: { itens: [{ maquina_tag, tipo, ciclos }] } ou array direto.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseServer();
    const auditoriaId = params.id;

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const role = await getUserRole(supabase);
    if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // auditoria existe
    const { data: aud, error: audErr } = await supabase.from("auditorias").select("id").eq("id", auditoriaId).single();
    if (audErr || !aud) return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const itemsRaw = Array.isArray(body) ? body : body?.itens ?? body?.data ?? [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];

    const payload = items
      .map((it: any) => ({
        auditoria_id: auditoriaId,
        maquina_tag: String(it?.maquina_tag ?? "").trim(),
        tipo: it?.tipo ? String(it.tipo) : null,
        ciclos: toNonNegInt(it?.ciclos),
        // valores por enquanto ficam 0 (apuração vem depois)
        valor_total: 0,
        valor_repasse: 0,
        valor_cashback: 0,
        observacoes: null,
      }))
      .filter((p) => !!p.maquina_tag);

    if (payload.length === 0) {
      return NextResponse.json({ ok: true, upserted: 0, data: [] });
    }

    // precisa do UNIQUE (auditoria_id, maquina_tag) que te mandei no SQL
    const { data: saved, error: upErr } = await supabase
      .from("auditoria_fechamento_itens")
      .upsert(payload, { onConflict: "auditoria_id,maquina_tag" })
      .select("id, auditoria_id, maquina_tag, tipo, ciclos");

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      upserted: saved?.length ?? 0,
      data: (saved ?? []).map((r: any) => ({
        ...r,
        ciclos: Number(r.ciclos ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
