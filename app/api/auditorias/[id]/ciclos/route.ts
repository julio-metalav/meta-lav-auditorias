export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserAndRole, supabaseAdmin } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return s || "aberta";
}

// tenta buscar máquinas com coluna "maquina_tag"; se não existir, tenta "tag"
async function fetchCondoMaquinas(admin: any, condominioId: string) {
  // 1) tenta maquina_tag
  const q1 = await admin
    .from("condominio_maquinas")
    .select("id,condominio_id,maquina_tag,tipo,categoria,capacidade_kg,valor_ciclo")
    .eq("condominio_id", condominioId);

  if (!q1?.error) return q1;

  const msg = String(q1.error?.message ?? "").toLowerCase();
  if (!msg.includes("maquina_tag") && !msg.includes("column") && !msg.includes("does not exist")) {
    return q1; // erro real, não de coluna
  }

  // 2) fallback para tag
  const q2 = await admin
    .from("condominio_maquinas")
    .select("id,condominio_id,tag,tipo,categoria,capacidade_kg,valor_ciclo")
    .eq("condominio_id", condominioId);

  return q2;
}

function getTagFromRow(m: any) {
  return String(m?.maquina_tag ?? m?.tag ?? "").trim();
}

function expandMaquinas(maquinas: any[]) {
  const items: { maquina_tag: string; tipo: string; meta: any }[] = [];

  for (const m of maquinas ?? []) {
    const tag = getTagFromRow(m);
    const tipo = String(m?.tipo ?? m?.categoria ?? "").trim();
    if (!tag) continue;

    items.push({ maquina_tag: tag, tipo: tipo || "maquina", meta: m });
  }

  return items;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  const isAuditor = role === "auditor";
  const isStaff = roleGte(role, "interno");
  if (!isAuditor && !isStaff) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const auditoriaId = params.id;

  // Auditoria
  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("*")
    .eq("id", auditoriaId)
    .maybeSingle();

  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });
  if (!aud) return NextResponse.json({ error: "Auditoria não encontrada" }, { status: 404 });

  // Auditor: só pode ver se for dono OU se tiver vínculo do condomínio
  if (isAuditor && !isStaff) {
    const isOwner = !!aud.auditor_id && aud.auditor_id === ctx.user.id;

    const { data: ac, error: acErr } = await admin
      .from("auditor_condominios")
      .select("condominio_id")
      .eq("auditor_id", ctx.user.id)
      .eq("condominio_id", aud.condominio_id)
      .maybeSingle();

    if (acErr) return NextResponse.json({ error: acErr.message }, { status: 400 });

    const hasLink = !!ac?.condominio_id;
    if (!isOwner && !hasLink) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Máquinas do condomínio (fonte de valor_ciclo)
  const { data: maquinas, error: mErr } = await fetchCondoMaquinas(admin, aud.condominio_id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  // Itens salvos
  const { data: saved, error: sErr } = await admin
    .from("auditoria_ciclos")
    .select("id,auditoria_id,maquina_tag,tipo,categoria,capacidade_kg,ciclos")
    .eq("auditoria_id", auditoriaId);

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const expanded = expandMaquinas(maquinas ?? []);
  const map = new Map<string, any>((saved ?? []).map((r: any) => [String(r.maquina_tag), r]));

  const itens = expanded.map((x) => {
    const meta = x.meta ?? {};
    const savedRow = map.get(x.maquina_tag);

    return {
      id: savedRow?.id ?? null,
      auditoria_id: auditoriaId,
      maquina_tag: x.maquina_tag,
      tipo: savedRow?.tipo ?? x.tipo,
      ciclos: Number(savedRow?.ciclos ?? 0),

      // enriquecimento
      categoria: savedRow?.categoria ?? meta.categoria ?? null,
      capacidade_kg: savedRow?.capacidade_kg ?? meta.capacidade_kg ?? null,
      valor_ciclo: meta.valor_ciclo ?? null,
    };
  });

  return NextResponse.json({
    data: {
      auditoria: {
        id: aud.id,
        condominio_id: aud.condominio_id,
        mes_ref: aud.mes_ref,
        status: normalizeStatus(aud.status),
      },
      maquinas: maquinas ?? [],
      itens,
    },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  const isStaff = roleGte(role, "interno");
  if (!isStaff) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();
  const auditoriaId = params.id;

  const body = await req.json().catch(() => null);
  const itens = Array.isArray(body?.itens) ? body.itens : [];

  // Auditoria -> condominio_id (para mapear tag->categoria)
  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("id,condominio_id")
    .eq("id", auditoriaId)
    .single();

  if (audErr || !aud) return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });

  const { data: maquinas, error: mErr } = await fetchCondoMaquinas(admin, aud.condominio_id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  const tagMeta = new Map<string, { categoria: any; capacidade_kg: any; tipo: any }>();
  for (const m of maquinas ?? []) {
    const tag = getTagFromRow(m);
    if (!tag) continue;
    tagMeta.set(tag, {
      categoria: m?.categoria ?? null,
      capacidade_kg: m?.capacidade_kg ?? null,
      tipo: m?.tipo ?? null,
    });
  }

  // validação mínima
  for (const it of itens) {
    if (!it?.maquina_tag) return NextResponse.json({ error: "maquina_tag obrigatório" }, { status: 400 });
    if (Number.isNaN(Number(it?.ciclos ?? 0))) return NextResponse.json({ error: "ciclos inválido" }, { status: 400 });
  }

  // ✅ UPsert garantindo categoria NOT NULL
  const payload = itens.map((it: any) => {
    const tag = String(it.maquina_tag);
    const meta = tagMeta.get(tag);

    const categoria = String(it?.categoria ?? meta?.categoria ?? it?.tipo ?? meta?.tipo ?? "").trim() || null;

    return {
      auditoria_id: auditoriaId,
      maquina_tag: tag,
      tipo: it?.tipo ?? null,
      categoria, // <- obrigatório no banco
      capacidade_kg: it?.capacidade_kg ?? meta?.capacidade_kg ?? null,
      ciclos: Number(it?.ciclos ?? 0),
    };
  });

  // se ainda tiver categoria null, retorna erro bom
  const bad = payload.find((p: any) => !p.categoria);
  if (bad) {
    return NextResponse.json(
      { error: `categoria obrigatória para maquina_tag=${bad.maquina_tag}. Verifique cadastro em condominio_maquinas.` },
      { status: 400 }
    );
  }

  const { error: upErr } = await admin.from("auditoria_ciclos").upsert(payload, {
    onConflict: "auditoria_id,maquina_tag",
  });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
