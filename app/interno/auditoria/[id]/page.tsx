"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

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

  // pode vir junto do backend
  condominios?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;
  condominio?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;
};

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
};

type CicloItem = {
  maquina_tag: string;
  tipo?: string | null;
  ciclos: number;

  categoria?: "lavadora" | "secadora" | string | null;
  capacidade_kg?: number | null;
  valor_ciclo?: number | null;
};

function money(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";

  // Se não for JSON, devolve um erro bom (e evita "Unexpected token <")
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    const head = text.slice(0, 220).replace(/\s+/g, " ").trim();
    throw new Error(`${url} retornou ${res.status} (não-JSON). Trecho: ${head || "(vazio)"}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `${url} falhou (${res.status})`);
  return json;
}

function pickCondoFromAud(a: any): Condo | null {
  const c = a?.condominios ?? a?.condominio ?? null;
  if (!c) return null;

  const id = String(c.id ?? a.condominio_id ?? "").trim();
  const nome = String(c.nome ?? "").trim();
  const cidade = String(c.cidade ?? "").trim();
  const uf = String(c.uf ?? "").trim();

  if (!nome) return null;

  return {
    id: id || String(a.condominio_id ?? ""),
    nome,
    cidade,
    uf,
  };
}

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);
  const [condo, setCondo] = useState<Condo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // base manual modal
  const [needBase, setNeedBase] = useState(false);
  const [baseAgua, setBaseAgua] = useState("");
  const [baseEnergia, setBaseEnergia] = useState("");
  const [baseGas, setBaseGas] = useState("");
  const [savingBase, setSavingBase] = useState(false);

  // ciclos
  const [ciclos, setCiclos] = useState<CicloItem[]>([]);
  const [savingCiclos, setSavingCiclos] = useState(false);

  const isStaff = useMemo(() => {
    const r = me?.role ?? null;
    return r === "interno" || r === "gestor";
  }, [me?.role]);

  const titulo = useMemo(() => {
    if (!condo) return "—";
    return `${condo.nome} - ${condo.cidade}/${condo.uf}`;
  }, [condo]);

  const mesRef = aud?.mes_ref ?? "";
  const prevMes = useMemo(() => {
    if (!mesRef || mesRef.length < 10) return "";
    const [y, m] = mesRef.slice(0, 10).split("-").map((x) => Number(x));
    if (!y || !m) return "";
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yy}-${mm}-01`;
  }, [mesRef]);

  const consumo = useMemo(() => {
    const a = Number(aud?.agua_leitura ?? 0);
    const e = Number(aud?.energia_leitura ?? 0);
    const g = Number(aud?.gas_leitura ?? 0);

    const ba = aud?.base_agua;
    const be = aud?.base_energia;
    const bg = aud?.base_gas;

    const hasBase = ba !== null && ba !== undefined && be !== null && be !== undefined;
    const hasGasBase = bg !== null && bg !== undefined;

    return {
      hasBase,
      agua: hasBase ? a - Number(ba ?? 0) : null,
      energia: hasBase ? e - Number(be ?? 0) : null,
      gas: hasGasBase ? g - Number(bg ?? 0) : null,
    };
  }, [aud?.agua_leitura, aud?.energia_leitura, aud?.gas_leitura, aud?.base_agua, aud?.base_energia, aud?.base_gas]);

  const relatorio = useMemo(() => {
    const toLower = (s: any) => String(s ?? "").toLowerCase();

    const isLav = (it: CicloItem) => {
      const c = toLower(it.categoria);
      if (c) return c === "lavadora";
      return toLower(it.tipo).includes("lavadora") || toLower(it.maquina_tag).startsWith("lav");
    };

    const isSec = (it: CicloItem) => {
      const c = toLower(it.categoria);
      if (c) return c === "secadora";
      return toLower(it.tipo).includes("secadora") || toLower(it.maquina_tag).startsWith("sec");
    };

    const linhas = (ciclos ?? []).map((it) => {
      const valor = Number(it.valor_ciclo ?? 0);
      const receita = Number(it.ciclos ?? 0) * valor;
      return {
        ...it,
        valor_ciclo: valor,
        receita,
        bucket: isLav(it) ? "lavadora" : isSec(it) ? "secadora" : "outro",
      };
    });

    const sum = (arr: any[], key: string) => arr.reduce((acc, x) => acc + Number(x?.[key] ?? 0), 0);

    const lav = linhas.filter((x) => x.bucket === "lavadora");
    const sec = linhas.filter((x) => x.bucket === "secadora");
    const out = linhas.filter((x) => x.bucket === "outro");

    const lavCiclos = sum(lav, "ciclos");
    const secCiclos = sum(sec, "ciclos");
    const outCiclos = sum(out, "ciclos");

    const lavRec = sum(lav, "receita");
    const secRec = sum(sec, "receita");
    const outRec = sum(out, "receita");

    return {
      linhas,
      lav: { ciclos: lavCiclos, receita: lavRec },
      sec: { ciclos: secCiclos, receita: secRec },
      out: { ciclos: outCiclos, receita: outRec },
      total: {
        ciclos: lavCiclos + secCiclos + outCiclos,
        receita: lavRec + secRec + outRec,
      },
    };
  }, [ciclos]);

  async function carregar() {
    setLoading(true);
    setErr(null);

    try {
      const meJson = await fetchJSON("/api/me", { cache: "no-store" });
      setMe(meJson as Me);

      // Auditoria: aceita formatos diferentes (data.auditoria | data | raiz)
      const aJson = await fetchJSON(`/api/auditorias/${id}`, { cache: "no-store" });
      const root = (aJson?.data ?? aJson) as any;
      const a = (root?.auditoria ?? root) as any;

      const audRow: Aud = {
        id: String(a?.id ?? root?.id ?? id), // ✅ nunca undefined
        condominio_id: String(a?.condominio_id ?? root?.condominio_id ?? ""),
        mes_ref: (a?.mes_ref ?? a?.ano_mes ?? root?.mes_ref ?? root?.ano_mes ?? null) as any,
        status: a?.status ?? root?.status ?? null,

        agua_leitura: a?.agua_leitura ?? a?.leitura_agua ?? root?.agua_leitura ?? root?.leitura_agua ?? null,
        energia_leitura: a?.energia_leitura ?? a?.leitura_energia ?? root?.energia_leitura ?? root?.leitura_energia ?? null,
        gas_leitura: a?.gas_leitura ?? a?.leitura_gas ?? root?.gas_leitura ?? root?.leitura_gas ?? null,

        base_agua: a?.base_agua ?? root?.base_agua ?? null,
        base_energia: a?.base_energia ?? root?.base_energia ?? null,
        base_gas: a?.base_gas ?? root?.base_gas ?? null,

        // condo pode vir no root ou dentro do objeto auditoria
        condominios: root?.condominios ?? a?.condominios ?? null,
        condominio: root?.condominio ?? a?.condominio ?? null,
      };

      setAud(audRow);

      // ✅ NÃO chama /api/condominios/[id] (pode não existir)
      setCondo(pickCondoFromAud(audRow));

      const ciclosJson = await fetchJSON(`/api/auditorias/${id}/ciclos`, { cache: "no-store" });
      const list = (ciclosJson?.data?.itens ?? ciclosJson?.itens ?? ciclosJson?.data ?? []) as any[];

      const normalized: CicloItem[] = (list ?? []).map((x: any) => ({
        maquina_tag: String(x.maquina_tag ?? ""),
        tipo: x.tipo ?? null,
        ciclos: Number(x.ciclos ?? 0),
        categoria: x.categoria ?? null,
        capacidade_kg: x.capacidade_kg ? Number(x.capacidade_kg) : null,
        valor_ciclo: x.valor_ciclo !== null && x.valor_ciclo !== undefined ? Number(x.valor_ciclo) : null,
      }));
      setCiclos(normalized);

      const mustAskBase =
        (audRow.base_agua === null || audRow.base_energia === null) &&
        (meJson?.role === "interno" || meJson?.role === "gestor");

      setNeedBase(!!mustAskBase);

      if (mustAskBase) {
        setBaseAgua(audRow.base_agua !== null && audRow.base_agua !== undefined ? String(audRow.base_agua) : "");
        setBaseEnergia(audRow.base_energia !== null && audRow.base_energia !== undefined ? String(audRow.base_energia) : "");
        setBaseGas(audRow.base_gas !== null && audRow.base_gas !== undefined ? String(audRow.base_gas) : "");
      }
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
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao salvar base");
    } finally {
      setSavingBase(false);
    }
  }

  async function salvarCiclos() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setSavingCiclos(true);
    setErr(null);

    try {
      const res = await fetch(`/api/auditorias/${audId}/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: ciclos.map((x) => ({
            maquina_tag: x.maquina_tag,
            tipo: x.tipo ?? null,
            ciclos: Number(x.ciclos ?? 0),
          })),
        }),
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`/api/auditorias/${audId}/ciclos retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao salvar ciclos");

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado ao salvar ciclos");
    } finally {
      setSavingCiclos(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Fechamento (Interno)">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-extrabold">Fechamento (Interno)</div>
            <div className="text-xs text-gray-500">{titulo}</div>
            <div className="mt-1 text-xs text-gray-500">
              Mês: <b>{mesRef || "—"}</b> • Anterior: <b>{prevMes || "—"}</b> • ID: <b>{id}</b>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={carregar}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>
            <a className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" href="/auditorias">
              Voltar
            </a>
          </div>
        </div>

        {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div> : null}

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Consumo do mês (calculado)</div>
              <div className="text-xs text-gray-500">Base: {consumo.hasBase ? "informada manualmente" : "não definida"}</div>
            </div>

            <button
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setNeedBase(true)}
              disabled={!isStaff}
            >
              Definir leitura base
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="text-xs text-gray-500">Água</div>
              <div className="mt-1 text-sm">
                <div>
                  Atual: <b>{aud?.agua_leitura ?? "—"}</b>
                </div>
                <div>
                  Base: <b>{aud?.base_agua ?? "—"}</b>
                </div>
                <div>
                  Consumo: <b>{consumo.agua ?? "—"}</b>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="text-xs text-gray-500">Energia</div>
              <div className="mt-1 text-sm">
                <div>
                  Atual: <b>{aud?.energia_leitura ?? "—"}</b>
                </div>
                <div>
                  Base: <b>{aud?.base_energia ?? "—"}</b>
                </div>
                <div>
                  Consumo: <b>{consumo.energia ?? "—"}</b>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="text-xs text-gray-500">Gás</div>
              <div className="mt-1 text-sm">
                <div>
                  Atual: <b>{aud?.gas_leitura ?? "—"}</b>
                </div>
                <div>
                  Base: <b>{aud?.base_gas ?? "—"}</b>
                </div>
                <div>
                  Consumo: <b>{consumo.gas ?? "—"}</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Ciclos por máquina</div>
              <div className="text-xs text-gray-500">
                O Interno lança ciclos por máquina individual. A lista vem do cadastro do condomínio (condominio_maquinas).
              </div>
            </div>

            <button
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={salvarCiclos}
              disabled={savingCiclos}
            >
              {savingCiclos ? "Salvando..." : "Salvar ciclos"}
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-100">
            <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
              <div className="col-span-6">Máquina</div>
              <div className="col-span-3">Tipo</div>
              <div className="col-span-3 text-right">Ciclos</div>
            </div>

            {ciclos.map((it, idx) => (
              <div key={it.maquina_tag} className="grid grid-cols-12 items-center px-4 py-3">
                <div className="col-span-6 text-sm font-semibold">{it.maquina_tag}</div>
                <div className="col-span-3 text-xs text-gray-600">{it.tipo ?? "—"}</div>
                <div className="col-span-3 flex justify-end">
                  <input
                    className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-right text-sm"
                    value={String(it.ciclos ?? 0)}
                    inputMode="numeric"
                    onChange={(e) => {
                      const v = Number(e.target.value ?? 0);
                      setCiclos((prev) => prev.map((x, i) => (i === idx ? { ...x, ciclos: Number.isNaN(v) ? 0 : v } : x)));
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Relatório financeiro (prévia)</div>
                <div className="text-xs text-gray-500">
                  Cálculo por máquina usando <b>condominio_maquinas.valor_ciclo</b>. Split: <b>Água = lavadoras</b>; <b>Gás = secadoras</b> (se houver gás).
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-gray-500">Receita total</div>
                <div className="text-lg font-extrabold">R$ {money(relatorio.total.receita)}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 p-3">
                <div className="text-xs text-gray-500">Lavadoras</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div className="text-sm font-semibold">{relatorio.lav.ciclos} ciclos</div>
                  <div className="text-sm font-extrabold">R$ {money(relatorio.lav.receita)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 p-3">
                <div className="text-xs text-gray-500">Secadoras</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div className="text-sm font-semibold">{relatorio.sec.ciclos} ciclos</div>
                  <div className="text-sm font-extrabold">R$ {money(relatorio.sec.receita)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 p-3">
                <div className="text-xs text-gray-500">Consumo do mês</div>
                <div className="mt-1 text-xs text-gray-600">
                  Água: <b>{consumo.agua ?? "—"}</b> • Energia: <b>{consumo.energia ?? "—"}</b> • Gás: <b>{consumo.gas ?? "—"}</b>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">(Energia pode afetar lavadora e secadora; água só lavadora; gás só secadora onde existir.)</div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Próximo passo: bloco de <b>Relatório financeiro</b> (repasse/conta/comprovante) + botão <b>Finalizar auditoria</b> (status = final) só após anexo.
          </div>
        </div>
      </div>

      {needBase && isStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Leitura anterior não encontrada</div>
                <div className="mt-1 text-xs text-gray-600">
                  Condomínio novo ou histórico vazio. Informe a leitura anterior/base para o cálculo do consumo do mês.
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Condomínio: <b>{titulo}</b> • Mês: <b>{mesRef}</b> • Anterior: <b>{prevMes}</b>
                </div>
              </div>

              <button className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50" onClick={() => setNeedBase(false)} disabled={savingBase}>
                Fechar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Água (base)</label>
                <input
                  className="w-full rounded-xl border px-3 py-2"
                  value={baseAgua}
                  onChange={(e) => setBaseAgua(e.target.value)}
                  inputMode="decimal"
                  placeholder="ex: 12345"
                  disabled={savingBase}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Energia (base)</label>
                <input
                  className="w-full rounded-xl border px-3 py-2"
                  value={baseEnergia}
                  onChange={(e) => setBaseEnergia(e.target.value)}
                  inputMode="decimal"
                  placeholder="ex: 67890"
                  disabled={savingBase}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Gás (base)</label>
                <input
                  className="w-full rounded-xl border px-3 py-2"
                  value={baseGas}
                  onChange={(e) => setBaseGas(e.target.value)}
                  inputMode="decimal"
                  placeholder="se não tiver, vazio"
                  disabled={savingBase}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50" onClick={() => setNeedBase(false)} disabled={savingBase}>
                Cancelar
              </button>

              <button
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={salvarBaseManual}
                disabled={savingBase}
              >
                {savingBase ? "Salvando..." : "Salvar base"}
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500">Depois que tiver histórico, isso some: o sistema usa automaticamente o mês anterior.</div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
