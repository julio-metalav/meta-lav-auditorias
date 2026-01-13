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
  if (s === "em conferência" || s === "em conferencia" || s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento" || s === "em_andamento") return "em_andamento";
  if (s === "finalizado" || s === "final") return "final";
  if (s === "aberto" || s === "aberta") return "aberta";
  return s || "aberta";
}

function validMonthISO(s: string) {
  return /^\d{4}-\d{2}-01$/.test(s);
}

function prevMonthISO(mesRef: string) {
  const [y, m] = mesRef.split("-").map((x) => Number(x));
  const d = new Date(y, (m ?? 1) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function toNum(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pctDelta(curr: number, prev: number): number | null {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

type CondoRow = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;

  cashback_percent: number | null;

  usa_gas: boolean | null;
  tarifa_agua_m3: number | null;
  tarifa_energia_kwh: number | null;
  tarifa_gas_m3: number | null;

  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  tipo_conta?: string | null;
  pix?: string | null;

  banco_nome?: string | null;
  banco_agencia?: string | null;
  banco_conta?: string | null;
  banco_pix?: string | null;

  favorecido_nome?: string | null;
  favorecido_cnpj?: string | null;
};

type AudRow = {
  id: string;
  condominio_id: string;
  mes_ref: string | null;
  status: string | null;

  agua_leitura: number | null;
  energia_leitura: number | null;
  gas_leitura: number | null;

  agua_leitura_base?: number | null;
  energia_leitura_base?: number | null;
  gas_leitura_base?: number | null;
};

type CicloRow = {
  auditoria_id: string;
  maquina_tag: string;
  tipo: string | null;
  ciclos: number | null;
};

type MaqMeta = {
  tag: string;
  categoria?: string | null;
  tipo?: string | null;
  valor_ciclo?: number | null;
};

async function detectTagColumn(admin: ReturnType<typeof supabaseAdmin>) {
  const tries = ["maquina_tag", "tag"];
  for (const col of tries) {
    const { error } = await admin.from("condominio_maquinas").select(`${col}`).limit(1);
    if (!error) return col;
  }
  throw new Error("Não encontrei coluna de tag em condominio_maquinas (tentei maquina_tag, tag).");
}

function pickPayment(c: CondoRow) {
  const pix = (c.banco_pix ?? c.pix ?? "").trim();
  const banco = (c.banco_nome ?? c.banco ?? "").trim();
  const agencia = (c.banco_agencia ?? c.agencia ?? "").trim();
  const conta = (c.banco_conta ?? c.conta ?? "").trim();
  const tipo_conta = (c.tipo_conta ?? "").trim();
  const favorecido_nome = (c.favorecido_nome ?? "").trim();
  const favorecido_cnpj = (c.favorecido_cnpj ?? "").trim();

  return { pix, banco, agencia, conta, tipo_conta, favorecido_nome, favorecido_cnpj };
}

function isLavadora(meta: MaqMeta) {
  const c = String(meta.categoria ?? "").toLowerCase();
  const t = String(meta.tipo ?? "").toLowerCase();
  if (c) return c.includes("lav");
  return t.includes("lav") || String(meta.tag).toLowerCase().startsWith("lav");
}

function isSecadora(meta: MaqMeta) {
  const c = String(meta.categoria ?? "").toLowerCase();
  const t = String(meta.tipo ?? "").toLowerCase();
  if (c) return c.includes("sec");
  return t.includes("sec") || String(meta.tag).toLowerCase().startsWith("sec");
}

function calcConsumo(cur: AudRow | undefined, prev: AudRow | undefined) {
  if (cur && prev) {
    const agua = cur.agua_leitura != null && prev.agua_leitura != null ? cur.agua_leitura - prev.agua_leitura : null;
    const energia =
      cur.energia_leitura != null && prev.energia_leitura != null ? cur.energia_leitura - prev.energia_leitura : null;
    const gas = cur.gas_leitura != null && prev.gas_leitura != null ? cur.gas_leitura - prev.gas_leitura : null;
    return { agua, energia, gas, origem: "mes_anterior" as const };
  }

  if (cur) {
    const agua =
      cur.agua_leitura != null && cur.agua_leitura_base != null ? cur.agua_leitura - cur.agua_leitura_base : null;
    const energia =
      cur.energia_leitura != null && cur.energia_leitura_base != null
        ? cur.energia_leitura - cur.energia_leitura_base
        : null;
    const gas = cur.gas_leitura != null && cur.gas_leitura_base != null ? cur.gas_leitura - cur.gas_leitura_base : null;

    const hasAnyBase = cur.agua_leitura_base != null || cur.energia_leitura_base != null || cur.gas_leitura_base != null;
    return { agua, energia, gas, origem: hasAnyBase ? ("base_manual" as const) : ("sem_base" as const) };
  }

  return { agua: null, energia: null, gas: null, origem: "sem_base" as const };
}

export async function GET(req: Request) {
  const ctx = await getUserAndRole();
  if (!ctx?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const role = (ctx.role ?? null) as Role | null;
  if (!roleGte(role, "interno")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const admin = supabaseAdmin();

  const { searchParams } = new URL(req.url);
  const mes_ref = String(searchParams.get("mes_ref") ?? "").trim();
  const statusFilter = String(searchParams.get("status") ?? "em_conferencia").trim();

  if (!mes_ref || !validMonthISO(mes_ref)) {
    return NextResponse.json({ error: "mes_ref inválido. Use YYYY-MM-01" }, { status: 400 });
  }

  const prev_mes_ref = prevMonthISO(mes_ref);

  try {
    const tagCol = await detectTagColumn(admin);

    const { data: audMes, error: audErr } = await admin
      .from("auditorias")
      .select(
        "id,condominio_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,agua_leitura_base,energia_leitura_base,gas_leitura_base"
      )
      .eq("mes_ref", mes_ref)
      .eq("status", normalizeStatus(statusFilter));

    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

    const auditorias = (audMes ?? []) as AudRow[];
    const condoIds = Array.from(new Set(auditorias.map((a) => a.condominio_id).filter(Boolean)));

    if (condoIds.length === 0) {
      return NextResponse.json({
        data: {
          header: { mes_ref, prev_mes_ref, status: normalizeStatus(statusFilter), total_condominios: 0 },
          linhas: [],
        },
      });
    }

    const { data: condos, error: cErr } = await admin
      .from("condominios")
      .select(
        "id,nome,cidade,uf,cashback_percent,usa_gas,tarifa_agua_m3,tarifa_energia_kwh,tarifa_gas_m3,banco,agencia,conta,tipo_conta,pix,favorecido_cnpj,banco_nome,banco_agencia,banco_conta,banco_pix,favorecido_nome"
      )
      .in("id", condoIds);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
    const condoMap = new Map<string, CondoRow>((condos ?? []).map((c: any) => [c.id, c as CondoRow]));

    const { data: audPrev, error: pErr } = await admin
      .from("auditorias")
      .select(
        "id,condominio_id,mes_ref,status,agua_leitura,energia_leitura,gas_leitura,agua_leitura_base,energia_leitura_base,gas_leitura_base"
      )
      .eq("mes_ref", prev_mes_ref)
      .in("condominio_id", condoIds);

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    const prevByCondo = new Map<string, AudRow>();
    for (const r of (audPrev ?? []) as any[]) {
      if (r?.condominio_id) prevByCondo.set(String(r.condominio_id), r as AudRow);
    }

    const audIdsMes = auditorias.map((a) => a.id);
    const { data: ciclosMes, error: cyErr } = await admin
      .from("auditoria_ciclos")
      .select("auditoria_id,maquina_tag,tipo,ciclos")
      .in("auditoria_id", audIdsMes);

    if (cyErr) return NextResponse.json({ error: cyErr.message }, { status: 400 });

    const { data: maqRows, error: mErr } = await admin
      .from("condominio_maquinas")
      .select(`condominio_id,${tagCol},categoria,tipo,valor_ciclo`)
      .in("condominio_id", condoIds);

    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

    const maqMapByCondo = new Map<string, Map<string, MaqMeta>>();
    for (const r of (maqRows ?? []) as any[]) {
      const cid = String(r.condominio_id ?? "");
      const tag = String(r?.[tagCol] ?? "").trim();
      if (!cid || !tag) continue;
      if (!maqMapByCondo.has(cid)) maqMapByCondo.set(cid, new Map());
      maqMapByCondo.get(cid)!.set(tag, {
        tag,
        categoria: r.categoria ?? null,
        tipo: r.tipo ?? null,
        valor_ciclo: r.valor_ciclo ?? null,
      });
    }

    const prevAudIds = Array.from(new Set((audPrev ?? []).map((a: any) => a.id).filter(Boolean)));
    let ciclosPrev: CicloRow[] = [];
    if (prevAudIds.length) {
      const { data: cyP, error: cyPErr } = await admin
        .from("auditoria_ciclos")
        .select("auditoria_id,maquina_tag,tipo,ciclos")
        .in("auditoria_id", prevAudIds);

      if (cyPErr) return NextResponse.json({ error: cyPErr.message }, { status: 400 });
      ciclosPrev = (cyP ?? []) as any;
    }

    const audByIdMes = new Map<string, AudRow>(auditorias.map((a) => [a.id, a]));
    const audByIdPrev = new Map<string, AudRow>(((audPrev ?? []) as any[]).map((a: any) => [a.id, a as AudRow]));

    const prevAudIdByCondo = new Map<string, string>();
    for (const a of (audPrev ?? []) as any[]) {
      const cid = String(a.condominio_id ?? "");
      if (cid && a?.id) prevAudIdByCondo.set(cid, String(a.id));
    }

    function receitaFromCiclos(auditoriaId: string, isPrev: boolean) {
      const aud = isPrev ? audByIdPrev.get(auditoriaId) : audByIdMes.get(auditoriaId);
      if (!aud) return { receita: 0 };

      const cid = aud.condominio_id;
      const mMap = maqMapByCondo.get(cid) ?? new Map<string, MaqMeta>();

      const list = (isPrev ? ciclosPrev : (ciclosMes ?? [])) as any[];
      const rows = list.filter((r) => String(r.auditoria_id) === String(auditoriaId));

      let total = 0;
      for (const r of rows) {
        const tag = String(r.maquina_tag ?? "").trim();
        const ciclos = toNum(r.ciclos ?? 0);
        const meta = mMap.get(tag) ?? { tag, tipo: r.tipo ?? null, categoria: null, valor_ciclo: null };
        const valor = toNum(meta.valor_ciclo ?? 0);
        total += ciclos * valor;
      }
      return { receita: total };
    }

    const linhas = auditorias.map((a) => {
      const c = condoMap.get(a.condominio_id) ?? null;

      const consumo = calcConsumo(a, prevByCondo.get(a.condominio_id));
      const tarifaAgua = toNum(c?.tarifa_agua_m3);
      const tarifaEnergia = toNum(c?.tarifa_energia_kwh);
      const tarifaGas = toNum(c?.tarifa_gas_m3);
      const usaGas = !!c?.usa_gas;

      const repasseAgua = consumo.agua == null ? 0 : toNum(consumo.agua) * tarifaAgua;
      const repasseEnergia = consumo.energia == null ? 0 : toNum(consumo.energia) * tarifaEnergia;
      const repasseGas = !usaGas || consumo.gas == null ? 0 : toNum(consumo.gas) * tarifaGas;
      const repasseTotal = repasseAgua + repasseEnergia + repasseGas;

      const recMes = receitaFromCiclos(a.id, false);
      const cashbackPct = toNum(c?.cashback_percent);
      const cashbackValor = (recMes.receita * cashbackPct) / 100;

      const totalPagar = cashbackValor + repasseTotal;

      const prevAudId = prevAudIdByCondo.get(a.condominio_id) ?? null;
      const prevCashback = prevAudId ? (receitaFromCiclos(prevAudId, true).receita * cashbackPct) / 100 : 0;

      const cashDelta = prevAudId ? pctDelta(cashbackValor, prevCashback) : null;

      const pay = c
        ? pickPayment(c)
        : { pix: "", banco: "", agencia: "", conta: "", tipo_conta: "", favorecido_nome: "", favorecido_cnpj: "" };

      return {
        auditoria_id: a.id,
        condominio_id: a.condominio_id,
        condominio_nome: c?.nome ?? "",
        cidade: c?.cidade ?? "",
        uf: c?.uf ?? "",

        mes_ref,
        prev_mes_ref,

        receita_total: recMes.receita,
        cashback_percent: cashbackPct,
        cashback_valor: cashbackValor,
        cashback_delta_percent: cashDelta,

        repasse_agua: repasseAgua,
        repasse_energia: repasseEnergia,
        repasse_gas: repasseGas,
        repasse_total: repasseTotal,
        repasse_delta_percent: null,

        total_pagar: totalPagar,

        pagamento: {
          favorecido_nome: pay.favorecido_nome,
          favorecido_cnpj: pay.favorecido_cnpj,
          pix: pay.pix,
          banco: pay.banco,
          agencia: pay.agencia,
          conta: pay.conta,
          tipo_conta: pay.tipo_conta,
        },
      };
    });

    return NextResponse.json({
      data: {
        header: {
          mes_ref,
          prev_mes_ref,
          status: normalizeStatus(statusFilter),
          total_condominios: linhas.length,
        },
        linhas,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
