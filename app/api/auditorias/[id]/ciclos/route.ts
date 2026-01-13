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

function isMissingColumnError(err: any, col: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes(col.toLowerCase()) && msg.includes("does not exist");
}

// Detecta se auditoria_ciclos tem coluna maquina_tag (schema novo) ou não (schema antigo)
async function detectAuditoriaCiclosHasMaquinaTag(admin: any): Promise<boolean> {
  const { error } = await admin.from("auditoria_ciclos").select("maquina_tag").limit(1);
  if (!error) return true;
  if (isMissingColumnError(error, "maquina_tag")) return false;
  // Se deu outro erro, não chuta: assume false para não quebrar inserts
  return false;
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

  // Máquinas do condomínio: AGORA é maquina_tag (definitivo)
  const { data: maquinas, error: mErr } = await admin
    .from("condominio_maquinas")
    .select("id,condominio_id,maquina_tag,categoria,capacidade_kg,quantidade,valor_ciclo,ativo")
    .eq("condominio_id", aud.condominio_id)
    .order("categoria", { ascending: true })
    .order("capacidade_kg", { ascending: true })
    .order("maquina_tag", { ascending: true });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  // Detecta schema auditoria_ciclos
  const hasMaquinaTag = await detectAuditoriaCiclosHasMaquinaTag(admin);

  // Itens salvos (compat)
  let saved: any[] = [];
  if (hasMaquinaTag) {
    const { data, error } = await admin
      .from("auditoria_ciclos")
      .select("id,auditoria_id,maquina_tag,tipo,categoria,capacidade_kg,ciclos")
      .eq("auditoria_id", auditoriaId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    saved = data ?? [];
  } else {
    const { data, error } = await admin
      .from("auditoria_ciclos")
      .select("id,auditoria_id,categoria,capacidade_kg,ciclos")
      .eq("auditoria_id", auditoriaId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    saved = data ?? [];
  }

  // Mapas
  const byTag = new Map<string, any>();
  for (const m of maquinas ?? []) {
    const tag = String(m?.maquina_tag ?? "").trim();
    if (!tag) continue;
    byTag.set(tag, m);
  }

  // Se schema antigo: saved é por (categoria+capacidade_kg)
  const byCatKg = new Map<string, any>();
  if (!hasMaquinaTag) {
    for (const r of saved ?? []) {
      const key = `${String(r?.categoria ?? "")}__${String(r?.capacidade_kg ?? "")}`;
      byCatKg.set(key, r);
    }
  }

  // itens para UI: sempre por maquina_tag
  const itens = (maquinas ?? [])
    .filter((m: any) => String(m?.maquina_tag ?? "").trim())
    .map((m: any) => {
      const maquina_tag = String(m.maquina_tag);
      const categoria = m.categoria ?? null;
      const capacidade_kg = m.capacidade_kg ?? null;

      let savedRow: any = null;

      if (hasMaquinaTag) {
        savedRow = (saved ?? []).find((r: any) => String(r?.maquina_tag ?? "") === maquina_tag) ?? null;
      } else {
        const key = `${String(categoria ?? "")}__${String(capacidade_kg ?? "")}`;
        savedRow = byCatKg.get(key) ?? null;
      }

      return {
        id: savedRow?.id ?? null,
        auditoria_id: auditoriaId,
        maquina_tag,
        // UI usa "tipo" só para exibir. Como não existe na tabela condominio_maquinas,
        // usamos categoria como tipo.
        tipo: savedRow?.tipo ?? categoria ?? null,
        ciclos: Number(savedRow?.ciclos ?? 0),

        // enriquecimento p/ relatório
        categoria,
        capacidade_kg,
        valor_ciclo: m.valor_ciclo ?? null,
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
      meta: { auditoria_ciclos_has_maquina_tag: hasMaquinaTag },
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

  // Auditoria -> condominio_id (para mapear maquina_tag -> categoria/capacidade)
  const { data: aud, error: audErr } = await admin
    .from("auditorias")
    .select("id,condominio_id")
    .eq("id", auditoriaId)
    .single();

  if (audErr || !aud) return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada" }, { status: 404 });

  const { data: maquinas, error: mErr } = await admin
    .from("condominio_maquinas")
    .select("maquina_tag,categoria,capacidade_kg")
    .eq("condominio_id", aud.condominio_id);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  const metaByTag = new Map<string, { categoria: any; capacidade_kg: any }>();
  for (const m of maquinas ?? []) {
    const tag = String(m?.maquina_tag ?? "").trim();
    if (!tag) continue;
    metaByTag.set(tag, { categoria: m?.categoria ?? null, capacidade_kg: m?.capacidade_kg ?? null });
  }

  // validação mínima
  for (const it of itens) {
    if (!it?.maquina_tag) return NextResponse.json({ error: "maquina_tag obrigatório" }, { status: 400 });
    if (Number.isNaN(Number(it?.ciclos ?? 0))) return NextResponse.json({ error: "ciclos inválido" }, { status: 400 });

    const tag = String(it.maquina_tag).trim();
    if (!metaByTag.has(tag)) {
      return NextResponse.json({ error: `maquina_tag não encontrada no cadastro do condomínio: ${tag}` }, { status: 400 });
    }
  }

  const hasMaquinaTag = await detectAuditoriaCiclosHasMaquinaTag(admin);

  if (hasMaquinaTag) {
    // schema novo (com maquina_tag)
    const payload = itens.map((it: any) => {
      const tag = String(it.maquina_tag).trim();
      const meta = metaByTag.get(tag)!;

      const categoria = String(meta.categoria ?? "").trim() || null;
      if (!categoria) {
        throw new Error(`categoria obrigatória no cadastro (condominio_maquinas) para maquina_tag=${tag}`);
      }

      return {
        auditoria_id: auditoriaId,
        maquina_tag: tag,
        tipo: it?.tipo ?? categoria,
        categoria,
        capacidade_kg: meta.capacidade_kg ?? null,
        ciclos: Number(it?.ciclos ?? 0),
      };
    });

    const { error: upErr } = await admin.from("auditoria_ciclos").upsert(payload, {
      onConflict: "auditoria_id,maquina_tag",
    });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, meta: { auditoria_ciclos_has_maquina_tag: true } });
  }

  // schema antigo (SEM maquina_tag) => grava por categoria+capacidade_kg
  const payloadOld = itens.map((it: any) => {
    const tag = String(it.maquina_tag).trim();
    const meta = metaByTag.get(tag)!;

    const categoria = String(meta.categoria ?? "").trim() || null;
    if (!categoria) {
      throw new Error(`categoria obrigatória no cadastro (condominio_maquinas) para maquina_tag=${tag}`);
    }

    return {
      auditoria_id: auditoriaId,
      categoria,
      capacidade_kg: meta.capacidade_kg ?? null,
      ciclos: Number(it?.ciclos ?? 0),
    };
  });

  const { error: upErrOld } = await admin.from("auditoria_ciclos").upsert(payloadOld, {
    onConflict: "auditoria_id,categoria,capacidade_kg",
  });

  if (upErrOld) return NextResponse.json({ error: upErrOld.message }, { status: 400 });

  return NextResponse.json({ ok: true, meta: { auditoria_ciclos_has_maquina_tag: false } });
}
