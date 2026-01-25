"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";
type PagamentoMetodo = "direto" | "boleto";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref: string | null;
  status: string | null;

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  base_agua?: number | null;
  base_energia?: number | null;
  base_gas?: number | null;

  // fechamento
  comprovante_fechamento_url?: string | null;
  fechamento_obs?: string | null;

  // vindo do backend (derivado do cadastro do condomínio)
  pagamento_metodo?: PagamentoMetodo | null;

  // vindo do backend (cadastro do condomínio)
  cashback_percent?: number | null;
  agua_valor_m3?: number | null;
  energia_valor_kwh?: number | null;
  gas_valor_m3?: number | null;

  // pode vir junto do backend
  condominios?: { nome: string; cidade: string; uf: string; cashback_percent?: number | null } | null;
  condominio?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;

  // (opcional) se o backend resolver mandar preços aqui no futuro, a UI já aproveita
  valor_ciclo_lavadora_10?: number | null;
  valor_ciclo_lavadora_15?: number | null;
  valor_ciclo_secadora_10?: number | null;
  valor_ciclo_secadora_15?: number | null;
};

type CicloItem = {
  id?: string | null;

  // compat (não usamos mais como “máquina individual”)
  maquina_tag?: string | null;
  tipo?: string | null;

  ciclos: number;

  categoria?: "lavadora" | "secadora" | string | null;
  capacidade_kg?: number | null;

  // vindo do backend /ciclos (ideal)
  valor_ciclo?: number | null;
};

type RelPrev = {
  receita_total: number | null; // null = não calculável (faltou preço)
  lavadoras_ciclos: number;
  secadoras_ciclos: number;
  lavadoras_valor: number | null;
  secadoras_valor: number | null;
  consumo_agua: number;
  consumo_energia: number;
  consumo_gas: number;
  faltou_preco: boolean;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function prevMonthISO(iso: string) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() - 1);
  return monthISO(d);
}

function toLower(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function safeNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function moneyBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function cicloLabel(it: CicloItem) {
  const cat = toLower(it.categoria ?? it.tipo);
  const cap = it.capacidade_kg ?? null;

  const nome = cat === "lavadora" ? "Lavadora" : cat === "secadora" ? "Secadora" : cat ? cat : "Máquina";

  if (cap) return `${nome} — ${cap}kg`;
  return nome;
}

function sameKey(a: CicloItem, b: CicloItem) {
  return toLower(a.categoria) === toLower(b.categoria) && Number(a.capacidade_kg ?? 0) === Number(b.capacidade_kg ?? 0);
}

/**
 * Só renderiza o que o backend disse que existe (categoria+capacidade),
 * e elimina duplicados por chave.
 */
function normalizeCiclos(list: CicloItem[]) {
  const out: CicloItem[] = [];

  for (const it of list ?? []) {
    const cat = toLower(it.categoria ?? it.tipo);
    const cap = it.capacidade_kg ?? null;

    if (!cat || cap === null || cap === undefined) continue;

    const normalized: CicloItem = {
      ...it,
      categoria: cat as any,
      capacidade_kg: Number(cap),
      ciclos: safeNumber(it.ciclos, 0),
      valor_ciclo: it.valor_ciclo !== null && it.valor_ciclo !== undefined ? Number(it.valor_ciclo) : null,
    };

    const idx = out.findIndex((x) => sameKey(x, normalized));
    if (idx >= 0) out[idx] = { ...out[idx], ...normalized };
    else out.push(normalized);
  }

  out.sort((a, b) => {
    const ac = toLower(a.categoria);
    const bc = toLower(b.categoria);
    if (ac !== bc) return ac === "lavadora" ? -1 : 1;
    return Number(a.capacidade_kg ?? 0) - Number(b.capacidade_kg ?? 0);
  });

  return out;
}

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`${String(input)} retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Falha na requisição");
  return json;
}

// 🎨 Paleta Meta-Lav (oficial do logo)
const BRAND = {
  primary: "#104774", // Azul Meta-Lav
  primaryDark: "#0D3A60",
  accent: "#F79232", // Laranja Meta-Lav
  aqua: "#1BABCD",
  soft: "#F3F7FB",
};

const btnGhost =
  "rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-60";
const card =
  "rounded-2xl border border-gray-100 bg-white p-5 shadow-sm";
const chip =
  "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);

  // base manual
  const [needBase, setNeedBase] = useState(false);
  const [baseEditMode, setBaseEditMode] = useState(false);
  const [baseAgua, setBaseAgua] = useState("");
  const [baseEnergia, setBaseEnergia] = useState("");
  const [baseGas, setBaseGas] = useState("");
  const [savingBase, setSavingBase] = useState(false);

  // ciclos por categoria + capacidade
  const [ciclos, setCiclos] = useState<CicloItem[]>([]);
  const [ciclosOrig, setCiclosOrig] = useState<CicloItem[]>([]);
  const [ciclosEditMode, setCiclosEditMode] = useState(false);
  const [savingCiclos, setSavingCiclos] = useState(false);

  // comprovante + obs financeiro
  const [fechamentoObs, setFechamentoObs] = useState("");
  const [uploadingComprovante, setUploadingComprovante] = useState(false);
  const [finalizando, setFinalizando] = useState(false);


  const role = me?.role ?? null;
  const isStaff = role === "interno" || role === "gestor";

  const mesRef = aud?.mes_ref ?? monthISO(new Date());
  const mesPrev = prevMonthISO(mesRef);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function carregar() {
    setLoading(true);
    setErr(null);

    try {
      const meJson = await fetchJSON("/api/me");
      setMe(meJson);

      const audJson = await fetchJSON(`/api/auditorias/${id}`);
      const audRow: Aud = audJson?.data ?? audJson;

      setAud(audRow);
      setFechamentoObs(String(audRow?.fechamento_obs ?? ""));

      const ciclosJson = await fetchJSON(`/api/auditorias/${id}/ciclos`);
      const list: any[] = Array.isArray(ciclosJson?.itens)
        ? ciclosJson.itens
        : Array.isArray(ciclosJson?.data?.itens)
        ? ciclosJson.data.itens
        : Array.isArray(ciclosJson?.items)
        ? ciclosJson.items
        : [];

      const normalizedRaw: CicloItem[] = (list ?? []).map((x: any) => ({
        id: x.id ?? null,
        maquina_tag: x.maquina_tag ?? null,
        tipo: x.tipo ?? null,
        ciclos: Number(x.ciclos ?? 0),
        categoria: x.categoria ?? null,
        capacidade_kg: x.capacidade_kg ? Number(x.capacidade_kg) : null,
        valor_ciclo: x.valor_ciclo !== null && x.valor_ciclo !== undefined ? Number(x.valor_ciclo) : null,
      }));

      const normalized = normalizeCiclos(normalizedRaw);

      setCiclos(normalized);
      setCiclosOrig(normalized);

      const mustAskBase =
        (audRow.base_agua === null || audRow.base_energia === null) &&
        (meJson?.role === "interno" || meJson?.role === "gestor");

      setNeedBase(!!mustAskBase);

      setBaseEditMode(false);
      setCiclosEditMode(false);

      setBaseAgua(audRow.base_agua !== null && audRow.base_agua !== undefined ? String(audRow.base_agua) : "");
      setBaseEnergia(audRow.base_energia !== null && audRow.base_energia !== undefined ? String(audRow.base_energia) : "");
      setBaseGas(audRow.base_gas !== null && audRow.base_gas !== undefined ? String(audRow.base_gas) : "");
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function salvarBaseManual() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setSavingBase(true);
    setErr(null);

    try {
      const res = await fetch(`/api/auditorias/${audId}/base`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_agua: baseAgua ? Number(baseAgua) : null,
          base_energia: baseEnergia ? Number(baseEnergia) : null,
          base_gas: baseGas ? Number(baseGas) : null,
        }),
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`/api/auditorias/${audId}/base retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao salvar base");

      setNeedBase(false);
      setBaseEditMode(false);
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao salvar base");
    } finally {
      setSavingBase(false);
    }
  }
  async function salvarCiclos() {
    try {
      setErr(null);
      setSavingCiclos(true);

      const itens = (ciclos ?? []).map((it) => {
        const categoria = String(it.categoria ?? it.tipo ?? "").toLowerCase().trim();
        const capacidade_kg = it.capacidade_kg ?? null;
        const ciclosInt = Number(it.ciclos ?? 0);
        return {
          categoria: categoria || null,
          capacidade_kg,
          ciclos: Number.isFinite(ciclosInt) ? ciclosInt : 0,
        };
      });

      const faltando = itens.find((it) => !it.categoria || !it.capacidade_kg);
      if (faltando) {
        throw new Error("ciclos: categoria e capacidade_kg são obrigatórios.");
      }

      await fetchJSON(`/api/auditorias/${id}/ciclos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itens }),
      });

      const ciclosJson = await fetchJSON(`/api/auditorias/${id}/ciclos`);
      const list: any[] = Array.isArray(ciclosJson?.itens)
        ? ciclosJson.itens
        : Array.isArray(ciclosJson?.data?.itens)
        ? ciclosJson.data.itens
        : Array.isArray(ciclosJson?.items)
        ? ciclosJson.items
        : [];

      const normalizedRaw: CicloItem[] = list.map((x: any) => ({
        id: x.id ?? null,
        categoria: x.categoria ?? null,
        capacidade_kg: x.capacidade_kg ?? null,
        ciclos: Number(x.ciclos ?? 0) || 0,
        valor_ciclo: x.valor_ciclo ?? null,
        maquina_tag: x.maquina_tag ?? null,
        tipo: x.tipo ?? null,
      }));

      const normalized = normalizeCiclos(normalizedRaw);

      setCiclos(normalized);
      setCiclosOrig(normalized);
      setCiclosEditMode(false);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSavingCiclos(false);
    }
  }

  function abrirModalBaseParaEditar() {
    if (!isStaff) return;
    setBaseEditMode(true);
    setNeedBase(true);
  }

  function cancelarEdicaoCiclos() {
    setCiclos(ciclosOrig);
    setCiclosEditMode(false);
  }

  async function uploadComprovante(file: File) {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setUploadingComprovante(true);
    setErr(null);

    try {
      const form = new FormData();
      form.append("kind", "comprovante_fechamento");
      form.append("file", file);
      if (String(fechamentoObs ?? "").trim()) form.append("fechamento_obs", String(fechamentoObs).trim());

      const res = await fetch(`/api/auditorias/${audId}/fotos`, {
        method: "POST",
        body: form,
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`/api/auditorias/${audId}/fotos retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao enviar comprovante");

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao enviar comprovante");
    } finally {
      setUploadingComprovante(false);
    }
  }

  async function salvarObsFinanceiro() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;
    try {
      setErr(null);
      await fetchJSON(`/api/auditorias/${audId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fechamento_obs: String(fechamentoObs ?? "") }),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar observação");
    }
  }

  const exigeComprovante = useMemo(() => {
    return (aud?.pagamento_metodo ?? null) === "direto";
  }, [aud?.pagamento_metodo]);

  const isFinal = useMemo(() => toLower(aud?.status) === "final", [aud?.status]);

  // links do relatório (somente quando FINAL)
  const reportHtmlHref = useMemo(() => `/relatorios/condominio/final/${id}`, [id]);
  const reportPdfHref = useMemo(() => `/api/relatorios/condominio/final/${id}/pdf`, [id]);

  const calculos = useMemo(() => {
    const aguaAtual = safeNumber(aud?.agua_leitura, 0);
    const energiaAtual = safeNumber(aud?.energia_leitura, 0);
    const gasAtual = safeNumber(aud?.gas_leitura, 0);

    const baseA = safeNumber(aud?.base_agua, safeNumber(baseAgua, 0));
    const baseE = safeNumber(aud?.base_energia, safeNumber(baseEnergia, 0));
    const baseG = safeNumber(aud?.base_gas, safeNumber(baseGas, 0));

    const consumoAgua = Math.max(aguaAtual - baseA, 0);
    const consumoEnergia = Math.max(energiaAtual - baseE, 0);
    const consumoGas = Math.max(gasAtual - baseG, 0);

    return { baseA, baseE, baseG, consumoAgua, consumoEnergia, consumoGas };
  }, [aud, baseAgua, baseEnergia, baseGas]);

  const relPrev: RelPrev = useMemo(() => {
    const items = ciclos ?? [];

    let lavC = 0;
    let secC = 0;

    let lavV = 0;
    let secV = 0;

    let faltouPreco = false;

    for (const it of items) {
      const cat = toLower(it.categoria ?? it.tipo ?? it.maquina_tag);
      const c = safeNumber(it.ciclos, 0);

      const isLav = cat === "lavadora" || cat.includes("lav");
      const isSec = cat === "secadora" || cat.includes("sec");

      const temPreco = it.valor_ciclo !== null && it.valor_ciclo !== undefined && Number.isFinite(Number(it.valor_ciclo));
      const v = temPreco ? Number(it.valor_ciclo) : null;

      if (!temPreco) {
        if (c > 0) faltouPreco = true;
      }

      if (isLav) {
        lavC += c;
        if (v !== null) lavV += c * v;
      } else if (isSec) {
        secC += c;
        if (v !== null) secV += c * v;
      } else {
        lavC += c;
        if (v !== null) lavV += c * v;
      }
    }

    const lavCalc = faltouPreco ? null : lavV;
    const secCalc = faltouPreco ? null : secV;
    const receita = faltouPreco ? null : lavV + secV;

    return {
      receita_total: receita,
      lavadoras_ciclos: lavC,
      secadoras_ciclos: secC,
      lavadoras_valor: lavCalc,
      secadoras_valor: secCalc,
      consumo_agua: calculos.consumoAgua,
      consumo_energia: calculos.consumoEnergia,
      consumo_gas: calculos.consumoGas,
      faltou_preco: faltouPreco,
    };
  }, [ciclos, calculos]);

  const financeiro = useMemo(() => {
    const receita = relPrev.receita_total; // null se faltou preço
    const cashbackPct = safeNumber(aud?.condominios?.cashback_percent ?? aud?.cashback_percent, 0);

    const cashback = receita === null ? null : receita * (cashbackPct / 100);

    const aguaV = safeNumber(aud?.agua_valor_m3, 0);
    const energiaV = safeNumber(aud?.energia_valor_kwh, 0);
    const gasV = safeNumber(aud?.gas_valor_m3, 0);

    const repAgua = relPrev.consumo_agua * aguaV;
    const repEnergia = relPrev.consumo_energia * energiaV;
    const repGas = relPrev.consumo_gas * gasV;

    const repasse = repAgua + repEnergia + repGas;

    const totalPagar = cashback === null ? null : cashback + repasse;
    const liquidoMetaLav = cashback === null ? null : receita! - cashback - repasse;

    return {
      cashbackPct,
      cashback,
      aguaV,
      energiaV,
      gasV,
      repAgua,
      repEnergia,
      repGas,
      repasse,
      totalPagar,
      liquidoMetaLav,
    };
  }, [aud, relPrev]);

  async function reabrirAuditoria() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    // só staff e só quando estiver final
    if (!isStaff) return;
    if (toLower(aud?.status) !== "final") return;

    try {
      setErr(null);
      setReabrindo(true);

      await fetchJSON(`/api/auditorias/${audId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "em_conferencia" }),
      });

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao reabrir auditoria");
    } finally {
      setReabrindo(false);
    }
  }
 
 async function finalizarAuditoria() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    if (toLower(aud?.status) === "final") return;

    try {
      setErr(null);
      setFinalizando(true);

      await salvarObsFinanceiro();

      if (exigeComprovante && !aud?.comprovante_fechamento_url) {
        throw new Error("Pagamento direto: anexe o comprovante para finalizar.");
      }

      await fetchJSON(`/api/auditorias/${audId}/finalizar`, { method: "POST" });
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao finalizar");
    } finally {
      setFinalizando(false);
    }
  }

  function statusLabel(s?: string | null) {
    const x = toLower(s);
    if (x === "aberta") return "aberta";
    if (x === "em_andamento") return "em andamento";
    if (x === "em_conferencia") return "em conferência";
    if (x === "final") return "final";
    return s ?? "-";
  }

  const condNome = aud?.condominio?.nome ?? aud?.condominios?.nome ?? "—";
  const condCidadeUf =
    (aud?.condominio?.cidade ?? aud?.condominios?.cidade ?? "") && (aud?.condominio?.uf ?? aud?.condominios?.uf ?? "")
      ? `${aud?.condominio?.cidade ?? aud?.condominios?.cidade}/${aud?.condominio?.uf ?? aud?.condominios?.uf}`
      : "—";

  const bloqueadoCiclos = !isStaff || !ciclosEditMode || savingCiclos || loading || isFinal;

  return (
    <AppShell title="Fechamento (Interno)">
      <div
        className="min-h-[calc(100vh-64px)]"
        style={
          {
            background: `linear-gradient(180deg, ${BRAND.soft} 0%, #ffffff 40%, #ffffff 100%)`,
          } as any
        }
      >
        <div className="mx-auto max-w-5xl px-4 py-6">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: BRAND.primary }}>
                Fechamento (Interno)
              </h1>
              <div className="mt-1 text-sm text-gray-600">
                <div className="truncate">
                  <span className="font-semibold text-gray-900">{condNome}</span>{" "}
                  <span className="text-gray-500">— {condCidadeUf}</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                    Mês: <span className="text-gray-900">{mesRef}</span>
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                    Anterior: <span className="text-gray-900">{mesPrev}</span>
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 font-semibold text-white shadow-sm"
                    style={{
                      backgroundColor: isFinal ? "#111827" : BRAND.primary,
                    }}
                  >
                    Status: {statusLabel(aud?.status)}
                  </span>

                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                    Pagamento: <span className="text-gray-900">{aud?.pagamento_metodo ?? "—"}</span>
                  </span>

                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-gray-700 shadow-sm ring-1 ring-gray-200">
                    ID: {id}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* ✅ Botões do relatório (somente quando FINAL) */}
              {isFinal ? (
                <>
                  <a
                    href={reportHtmlHref}
                    target="_blank"
                    rel="noreferrer"
                    className={btnGhost}
                    title="Abrir relatório final (visualização)"
                  >
                    Ver relatório
                  </a>
                  <a
                    href={reportPdfHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95"
                    style={{ backgroundColor: BRAND.primary }}
                    title="Baixar PDF do relatório final"
                  >
                    Baixar PDF
                  </a>
                </>
              ) : null}

              <button className={btnGhost} onClick={() => carregar()} disabled={loading}>
                Recarregar
              </button>

              <button className={btnGhost} onClick={() => history.back()}>
                Voltar
              </button>
            </div>
          </div>

          {err ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}

          {/* Comprovante + obs */}
          <div className={card}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-base font-semibold text-gray-900">Comprovante de fechamento</div>
                <div className="mt-1 text-sm text-gray-600">
                  {exigeComprovante ? (
                    <>Pagamento direto: anexe o comprovante (PDF ou imagem) para conseguir finalizar.</>
                  ) : (
                    <>Boleto: pode finalizar sem comprovante (pagamento será feito depois).</>
                  )}{" "}
                  {aud?.comprovante_fechamento_url ? (
                    <span className={`${chip}`} style={{ backgroundColor: BRAND.soft, color: BRAND.primary }}>
                      anexado
                    </span>
                  ) : (
                    <span className={`${chip} bg-orange-100 text-orange-700`}>pendente</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`cursor-pointer ${btnGhost} ${isFinal ? "opacity-60 pointer-events-none" : ""}`}
                >
                  {uploadingComprovante ? "Enviando..." : "Anexar comprovante"}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf"
                    disabled={uploadingComprovante || isFinal}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadComprovante(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <button
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:opacity-95"
                  style={{ backgroundColor: BRAND.primary }}
                  onClick={() => finalizarAuditoria()}
                  disabled={finalizando || loading || isFinal}
                >
                  {isFinal ? "Auditoria finalizada" : finalizando ? "Finalizando..." : "Finalizar auditoria"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-700">Obs do financeiro (opcional)</div>
              <textarea
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-300 disabled:bg-gray-50"
                rows={3}
                placeholder="Ex: pago via PIX em 2 parcelas / ajuste de valor / observações..."
                value={fechamentoObs}
                onChange={(e) => setFechamentoObs(e.target.value)}
                onBlur={() => salvarObsFinanceiro()}
                disabled={isFinal}
              />
              <div className="mt-2 text-xs text-gray-500">Se você preencher isso e anexar o comprovante, a observação vai junto.</div>
            </div>
          </div>

          {/* Consumo calculado */}
          <div className={`mt-6 ${card}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-gray-900">Consumo do mês (calculado)</div>
                <div className="mt-1 text-sm text-gray-600">
                  Base: informada manualmente{" "}
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                    {needBase ? "pendente" : "travada"}
                  </span>
                </div>
              </div>

              {isStaff ? (
                <button className={btnGhost} onClick={() => abrirModalBaseParaEditar()} disabled={isFinal}>
                  Alterar/corrigir base
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <div className="text-sm font-semibold text-gray-700">Água</div>
                <div className="mt-2 text-sm text-gray-700">
                  Atual: <span className="font-semibold">{safeNumber(aud?.agua_leitura, 0)}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Base: <span className="font-semibold">{calculos.baseA}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Consumo: <span className="font-semibold">{calculos.consumoAgua}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <div className="text-sm font-semibold text-gray-700">Energia</div>
                <div className="mt-2 text-sm text-gray-700">
                  Atual: <span className="font-semibold">{safeNumber(aud?.energia_leitura, 0)}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Base: <span className="font-semibold">{calculos.baseE}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Consumo: <span className="font-semibold">{calculos.consumoEnergia}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <div className="text-sm font-semibold text-gray-700">Gás</div>
                <div className="mt-2 text-sm text-gray-700">
                  Atual: <span className="font-semibold">{safeNumber(aud?.gas_leitura, 0)}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Base: <span className="font-semibold">{calculos.baseG}</span>
                </div>
                <div className="text-sm text-gray-700">
                  Consumo: <span className="font-semibold">{calculos.consumoGas}</span>
                </div>
              </div>
            </div>

            {/* Editor de base */}
            {baseEditMode ? (
              <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-800">Editar base (manual)</div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-700">Base água</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm disabled:bg-gray-50"
                      value={baseAgua}
                      onChange={(e) => setBaseAgua(e.target.value)}
                      inputMode="decimal"
                      disabled={isFinal}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700">Base energia</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm disabled:bg-gray-50"
                      value={baseEnergia}
                      onChange={(e) => setBaseEnergia(e.target.value)}
                      inputMode="decimal"
                      disabled={isFinal}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700">Base gás</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm disabled:bg-gray-50"
                      value={baseGas}
                      onChange={(e) => setBaseGas(e.target.value)}
                      inputMode="decimal"
                      disabled={isFinal}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
                    style={{ backgroundColor: BRAND.primary }}
                    onClick={() => salvarBaseManual()}
                    disabled={savingBase || isFinal}
                  >
                    {savingBase ? "Salvando..." : "Salvar base"}
                  </button>

                  <button
                    className={btnGhost}
                    onClick={() => {
                      setBaseEditMode(false);
                      setNeedBase(false);
                      carregar();
                    }}
                    disabled={savingBase}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {/* Ciclos */}
          <div className={`mt-6 ${card}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-gray-900">Ciclos (categoria + capacidade)</div>
                <div className="mt-1 text-sm text-gray-600">
                  O Interno lança ciclos por <span className="font-semibold">Lavadora/Secadora</span> e{" "}
                  <span className="font-semibold">10/15kg</span>.
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                    {ciclosEditMode ? "editando" : "travado"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!ciclosEditMode ? (
                  <button className={btnGhost} onClick={() => setCiclosEditMode(true)} disabled={!isStaff || loading || isFinal}>
                    Editar
                  </button>
                ) : (
                  <>
                    <button className={btnGhost} onClick={() => cancelarEdicaoCiclos()} disabled={savingCiclos}>
                      Cancelar
                    </button>

                    <button
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
                      style={{ backgroundColor: BRAND.primary }}
                      onClick={() => salvarCiclos()}
                      disabled={savingCiclos || isFinal}
                    >
                      {savingCiclos ? "Salvando..." : "Salvar ciclos"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-gray-100">
              <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
                <div className="col-span-6">Tipo</div>
                <div className="col-span-3 text-right">Valor ciclo</div>
                <div className="col-span-3 text-right">Ciclos</div>
              </div>

              <div className="divide-y divide-gray-100">
                {(ciclos ?? []).length === 0 ? (
                  <div className="px-4 py-4 text-sm text-gray-600">Lista de ciclos vazia.</div>
                ) : (
                  (ciclos ?? []).map((it, idx) => {
                    const key = `${String(it.categoria ?? "x")}-${String(it.capacidade_kg ?? "x")}`;
                    return (
                      <div key={key} className="grid grid-cols-12 items-center px-4 py-3">
                        <div className="col-span-6">
                          <div className="text-sm font-semibold text-gray-900">{cicloLabel(it)}</div>
                          <div className="text-xs text-gray-500">
                            categoria: {String(it.categoria ?? "—")} — capacidade: {it.capacidade_kg ? `${it.capacidade_kg}kg` : "—"}
                          </div>
                        </div>

                        <div className="col-span-3 text-right text-sm font-semibold text-gray-900">
                          {it.valor_ciclo !== null && it.valor_ciclo !== undefined ? moneyBRL(Number(it.valor_ciclo)) : "—"}
                        </div>

                        <div className="col-span-3 flex justify-end">
                          <input
                            className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-right text-sm shadow-sm outline-none focus:border-gray-300 disabled:bg-gray-50"
                            value={String(it.ciclos ?? 0)}
                            disabled={bloqueadoCiclos}
                            inputMode="numeric"
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^\d]/g, "");
                              const n = v ? Number(v) : 0;
                              setCiclos((prev) => prev.map((p, j) => (j === idx ? { ...p, ciclos: n } : p)));
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Prévia financeira */}
            <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Resumo financeiro (repasse + cashback)</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Cashback = % sobre a <span className="font-semibold">receita bruta</span>. Repasse = consumo × tarifa do condomínio.
                  </div>
                  {relPrev.faltou_preco ? (
                    <div className="mt-2 text-xs text-amber-700">
                      Atenção: faltou <span className="font-semibold">valor_ciclo</span> em pelo menos um item com ciclos &gt; 0. A receita/cashback não
                      será calculada até o preço vir do backend.
                    </div>
                  ) : null}
                </div>

                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-600">Total a pagar</div>
                  <div className="text-lg font-extrabold" style={{ color: BRAND.primary }}>
                    {financeiro.totalPagar === null ? "—" : moneyBRL(financeiro.totalPagar)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-gray-100 p-3">
                  <div className="text-xs font-semibold text-gray-600">Receita bruta</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{relPrev.receita_total === null ? "—" : moneyBRL(relPrev.receita_total)}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    Lavadoras: {relPrev.lavadoras_ciclos} — Secadoras: {relPrev.secadoras_ciclos}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 p-3">
                  <div className="text-xs font-semibold text-gray-600">Cashback</div>
                  <div className="mt-1 text-sm text-gray-700">
                    %: <span className="font-semibold">{Number(financeiro.cashbackPct ?? 0).toFixed(2)}%</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{financeiro.cashback === null ? "—" : moneyBRL(financeiro.cashback)}</div>
                </div>

                <div className="rounded-2xl border border-gray-100 p-3">
                  <div className="text-xs font-semibold text-gray-600">Repasse (insumos)</div>

                  <div className="mt-1 text-xs text-gray-700">
                    Água: <span className="font-semibold">{relPrev.consumo_agua}</span> × <span className="font-semibold">{moneyBRL(financeiro.aguaV)}</span>{" "}
                    = <span className="font-semibold">{moneyBRL(financeiro.repAgua)}</span>
                  </div>

                  <div className="mt-1 text-xs text-gray-700">
                    Energia: <span className="font-semibold">{relPrev.consumo_energia}</span> ×{" "}
                    <span className="font-semibold">{moneyBRL(financeiro.energiaV)}</span> ={" "}
                    <span className="font-semibold">{moneyBRL(financeiro.repEnergia)}</span>
                  </div>

                  <div className="mt-1 text-xs text-gray-700">
                    Gás: <span className="font-semibold">{relPrev.consumo_gas}</span> × <span className="font-semibold">{moneyBRL(financeiro.gasV)}</span> ={" "}
                    <span className="font-semibold">{moneyBRL(financeiro.repGas)}</span>
                  </div>

                  <div className="mt-2 text-sm font-semibold text-gray-900">Repasse total: {moneyBRL(financeiro.repasse)}</div>
                </div>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                (Opcional) Líquido Meta-Lav = Receita — Cashback — Repasse:{" "}
                <span className="font-semibold">{financeiro.liquidoMetaLav === null ? "—" : moneyBRL(financeiro.liquidoMetaLav)}</span>
              </div>
            </div>
          </div>

          {/* rodapé espaço */}
          <div className="h-10" />
        </div>
      </div>
    </AppShell>
  );
}
