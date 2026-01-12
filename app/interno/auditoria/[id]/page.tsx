"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor" | null;

type Me = {
  user: { id: string; email: string };
  role: Role;
};

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref?: string | null;
  ano_mes?: string | null;
  status: string | null;

  // leituras atuais (do mês)
  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  // leitura base manual (quando não existe mês anterior)
  agua_leitura_base?: number | null;
  energia_leitura_base?: number | null;
  gas_leitura_base?: number | null;
  leitura_base_origem?: string | null;

  condominios?: { id: string; nome: string; cidade: string; uf: string } | null;
};

type CicloItem = {
  maquina_tag: string;
  tipo?: string | null;
  ciclos: number;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  const txt = await res.text().catch(() => "");
  if (!txt) return {};
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(txt);
    } catch {
      return { _raw: txt };
    }
  }
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function prevMonthISO(isoYYYYMM01: string) {
  // iso = YYYY-MM-01
  const [y, m] = isoYYYYMM01.split("-").map((x) => Number(x));
  if (!y || !m) return isoYYYYMM01;
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function toNumOrNull(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fmt(n: any) {
  if (n === null || n === undefined) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString("pt-BR");
}

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const auditoriaId = params.id;

  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // ciclos (apuração)
  const [ciclos, setCiclos] = useState<CicloItem[]>([]);
  const [savingCiclos, setSavingCiclos] = useState(false);

  // leitura anterior encontrada automaticamente (se existir)
  const [autoBase, setAutoBase] = useState<{ agua?: number | null; energia?: number | null; gas?: number | null } | null>(null);

  // modal base manual
  const [needBase, setNeedBase] = useState(false);
  const [baseAgua, setBaseAgua] = useState("");
  const [baseEnergia, setBaseEnergia] = useState("");
  const [baseGas, setBaseGas] = useState("");
  const [savingBase, setSavingBase] = useState(false);

  const mesRef = useMemo(() => {
    const m = aud?.mes_ref ?? aud?.ano_mes;
    return (m ?? monthISO()) as string;
  }, [aud?.mes_ref, aud?.ano_mes]);

  const prevMes = useMemo(() => prevMonthISO(mesRef), [mesRef]);

  const titulo = useMemo(() => {
    const c = aud?.condominios;
    if (c) return `${c.nome} - ${c.cidade}/${c.uf}`;
    return aud?.condominio_id ?? "Auditoria";
  }, [aud?.condominios, aud?.condominio_id]);

  const isStaff = useMemo(() => {
    const r = me?.role ?? null;
    return r === "interno" || r === "gestor";
  }, [me?.role]);

  async function carregarTudo() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      if (!isUuid(auditoriaId)) throw new Error("ID inválido.");

      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário");
      setMe(meJson as Me);

      const aRes = await fetch(`/api/auditorias/${auditoriaId}`, { cache: "no-store" });
      const aJson = await safeJson(aRes);
      if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar auditoria");

      const found = (aJson?.auditoria ?? null) as Aud | null;
      if (!found) throw new Error("Auditoria não encontrada.");
      setAud(found);

      // ciclos
      const cRes = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, { cache: "no-store" });
      const cJson = await safeJson(cRes);
      if (cRes.ok) {
        const list = Array.isArray(cJson) ? (cJson as any[]) : (cJson?.data ?? []);
        const normalized: CicloItem[] = (list ?? []).map((x: any) => ({
          maquina_tag: String(x.maquina_tag ?? x.tag ?? ""),
          tipo: x.tipo ?? null,
          ciclos: Number(x.ciclos ?? 0),
        }));
        setCiclos(normalized.filter((x) => x.maquina_tag));
      }

      // tenta achar leitura anterior automaticamente (interno consegue listar todas)
      // estratégia simples: chama /api/auditorias (lista) e filtra por condominio + mês anterior
      try {
        const listRes = await fetch("/api/auditorias", { cache: "no-store" });
        const listJson = await safeJson(listRes);
        if (listRes.ok && Array.isArray(listJson)) {
          const all: any[] = listJson;
          const same = all.find(
            (x) =>
              String(x?.condominio_id ?? "") === String(found.condominio_id) &&
              String(x?.mes_ref ?? x?.ano_mes ?? "") === String(prevMes)
          );

          if (same) {
            setAutoBase({
              agua: same?.agua_leitura ?? null,
              energia: same?.energia_leitura ?? null,
              gas: same?.gas_leitura ?? null,
            });
          } else {
            setAutoBase(null);
          }
        }
      } catch {
        // ignora
      }

      // decide se precisa pedir base manual:
      // - se NÃO existe autoBase
      // - e também NÃO existe base manual já salva na auditoria
      // - e estamos no fluxo interno (staff)
      const hasManual =
        found.agua_leitura_base !== null && found.agua_leitura_base !== undefined
          ? true
          : found.energia_leitura_base !== null && found.energia_leitura_base !== undefined
          ? true
          : found.gas_leitura_base !== null && found.gas_leitura_base !== undefined
          ? true
          : false;

      // só pede se for staff; auditor não entra aqui normalmente, mas garante
      if (isStaff) {
        const noAuto = !autoBase; // (nota: state autoBase ainda pode estar null aqui; vamos recalcular depois em outro effect)
        if (!hasManual && noAuto) {
          // pré-preenche com vazio (ou com leituras atuais se existirem? melhor NÃO)
          setBaseAgua("");
          setBaseEnergia("");
          setBaseGas("");
          setNeedBase(true);
        } else {
          setNeedBase(false);
        }
      }
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  // reavalia needBase quando autoBase chegar
  useEffect(() => {
    if (!isStaff) return;
    if (!aud) return;

    const hasManual =
      aud.agua_leitura_base !== null && aud.agua_leitura_base !== undefined
        ? true
        : aud.energia_leitura_base !== null && aud.energia_leitura_base !== undefined
        ? true
        : aud.gas_leitura_base !== null && aud.gas_leitura_base !== undefined
        ? true
        : false;

    if (!hasManual && !autoBase) setNeedBase(true);
    if (hasManual || autoBase) setNeedBase(false);
  }, [autoBase, aud, isStaff]);

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditoriaId]);

  const baseUsada = useMemo(() => {
    // prioridade: autoBase (mês anterior) > manual base salva na auditoria
    const a = autoBase;
    if (a) return { origem: "auto", ...a };

    if (aud) {
      const anyManual =
        aud.agua_leitura_base !== null && aud.agua_leitura_base !== undefined
          ? true
          : aud.energia_leitura_base !== null && aud.energia_leitura_base !== undefined
          ? true
          : aud.gas_leitura_base !== null && aud.gas_leitura_base !== undefined
          ? true
          : false;

      if (anyManual) {
        return {
          origem: "manual",
          agua: aud.agua_leitura_base ?? null,
          energia: aud.energia_leitura_base ?? null,
          gas: aud.gas_leitura_base ?? null,
        };
      }
    }
    return null;
  }, [autoBase, aud]);

  const consumo = useMemo(() => {
    const b = baseUsada;
    if (!aud || !b) return null;

    const aA = aud.agua_leitura ?? null;
    const aE = aud.energia_leitura ?? null;
    const aG = aud.gas_leitura ?? null;

    const cA = aA !== null && b.agua !== null && b.agua !== undefined ? Number(aA) - Number(b.agua ?? 0) : null;
    const cE = aE !== null && b.energia !== null && b.energia !== undefined ? Number(aE) - Number(b.energia ?? 0) : null;
    const cG = aG !== null && b.gas !== null && b.gas !== undefined ? Number(aG) - Number(b.gas ?? 0) : null;

    return {
      agua: cA !== null && Number.isFinite(cA) ? cA : null,
      energia: cE !== null && Number.isFinite(cE) ? cE : null,
      gas: cG !== null && Number.isFinite(cG) ? cG : null,
    };
  }, [aud, baseUsada]);

  async function salvarBaseManual() {
    setErr(null);
    setOk(null);

    if (!aud) return;
    if (!isStaff) return setErr("Sem permissão.");

    setSavingBase(true);
    try {
      const res = await fetch(`/api/auditorias/${auditoriaId}/base`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agua_leitura_base: toNumOrNull(baseAgua),
          energia_leitura_base: toNumOrNull(baseEnergia),
          gas_leitura_base: toNumOrNull(baseGas),
        }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar base");

      // atualiza auditoria em memória
      setAud((prev) => {
        if (!prev) return prev;
        const b = json?.base ?? {};
        return {
          ...prev,
          agua_leitura_base: b.agua_leitura_base ?? prev.agua_leitura_base ?? null,
          energia_leitura_base: b.energia_leitura_base ?? prev.energia_leitura_base ?? null,
          gas_leitura_base: b.gas_leitura_base ?? prev.gas_leitura_base ?? null,
          leitura_base_origem: b.leitura_base_origem ?? "manual",
        };
      });

      setNeedBase(false);
      setOk("Leitura base salva ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar base");
    } finally {
      setSavingBase(false);
    }
  }

  async function salvarCiclos() {
    setErr(null);
    setOk(null);

    if (!aud) return;
    if (!isStaff) return setErr("Sem permissão.");

    setSavingCiclos(true);
    try {
      // Mantém o endpoint que você já usa: /api/auditorias/[id]/ciclos
      // Envia lista: [{maquina_tag, tipo, ciclos}]
      const res = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: ciclos }),
      });

      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar ciclos");

      setOk("Ciclos salvos ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar ciclos");
    } finally {
      setSavingCiclos(false);
    }
  }

  if (!isUuid(auditoriaId)) {
    return (
      <AppShell title="Auditoria (Interno)">
        <div className="card" style={{ marginTop: 12 }}>
          <h2>ID inválido</h2>
          <p>Esta página deve ser acessada a partir da lista de auditorias.</p>
          <button className="btn" onClick={() => router.push("/auditorias")} style={{ marginTop: 12 }}>
            Voltar para Auditorias
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Auditoria (Interno)">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Fechamento (Interno)</h1>
            <div className="mt-1 text-sm text-gray-600 truncate">{titulo}</div>
            <div className="mt-2 text-xs text-gray-500">
              Mês: <b>{mesRef}</b> • Anterior: <b>{prevMes}</b> • ID: <span className="font-mono">{auditoriaId}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={carregarTudo}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>

            <Link className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" href="/auditorias">
              Voltar
            </Link>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
        {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

        {/* Painel de consumo (usa base auto ou manual) */}
        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Consumo do mês (calculado)</div>
              <div className="mt-1 text-xs text-gray-500">
                Base:{" "}
                <b>
                  {baseUsada
                    ? baseUsada.origem === "auto"
                      ? "mês anterior (auto)"
                      : "informada manualmente"
                    : "não definida"}
                </b>
              </div>
            </div>

            {isStaff && (
              <button
                className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                onClick={() => setNeedBase(true)}
                disabled={loading || !aud}
                title="Definir/editar leitura base manual"
              >
                Definir leitura base
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500">Água</div>
              <div className="mt-1 text-sm">
                Atual: <b>{fmt(aud?.agua_leitura)}</b>
              </div>
              <div className="text-sm">
                Base: <b>{fmt(baseUsada?.agua)}</b>
              </div>
              <div className="mt-1 text-sm">
                Consumo: <b>{consumo ? fmt(consumo.agua) : "—"}</b>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500">Energia</div>
              <div className="mt-1 text-sm">
                Atual: <b>{fmt(aud?.energia_leitura)}</b>
              </div>
              <div className="text-sm">
                Base: <b>{fmt(baseUsada?.energia)}</b>
              </div>
              <div className="mt-1 text-sm">
                Consumo: <b>{consumo ? fmt(consumo.energia) : "—"}</b>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500">Gás</div>
              <div className="mt-1 text-sm">
                Atual: <b>{fmt(aud?.gas_leitura)}</b>
              </div>
              <div className="text-sm">
                Base: <b>{fmt(baseUsada?.gas)}</b>
              </div>
              <div className="mt-1 text-sm">
                Consumo: <b>{consumo ? fmt(consumo.gas) : "—"}</b>
              </div>
            </div>
          </div>

          {!baseUsada && (
            <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
              Não encontrei leitura do mês anterior e ainda não existe base manual salva.
              <br />
              Clique em <b>“Definir leitura base”</b> para informar a leitura anterior.
            </div>
          )}
        </div>

        {/* Ciclos por máquina */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Ciclos por máquina</div>
              <div className="mt-1 text-xs text-gray-500">
                Aqui o Interno lança ciclos. O valor do ciclo vem do cadastro do ponto/máquina.
              </div>
            </div>

            <button
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={salvarCiclos}
              disabled={savingCiclos || loading || !aud || !isStaff}
              title={!isStaff ? "Sem permissão" : "Salvar ciclos"}
            >
              {savingCiclos ? "Salvando..." : "Salvar ciclos"}
            </button>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
              <div className="col-span-5">Máquina</div>
              <div className="col-span-4">Tipo</div>
              <div className="col-span-3 text-right">Ciclos</div>
            </div>

            <div className="divide-y">
              {ciclos.length === 0 && (
                <div className="px-3 py-3 text-sm text-gray-600">Nenhum item encontrado (ou endpoint /ciclos ainda vazio).</div>
              )}

              {ciclos.map((it, idx) => (
                <div key={`${it.maquina_tag}-${idx}`} className="grid grid-cols-12 px-3 py-2 text-sm items-center">
                  <div className="col-span-5 font-mono text-xs text-gray-800">{it.maquina_tag}</div>
                  <div className="col-span-4 text-gray-700">{it.tipo ?? "—"}</div>
                  <div className="col-span-3 flex justify-end">
                    <input
                      className="w-24 rounded-lg border px-2 py-1 text-right"
                      value={String(it.ciclos ?? 0)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        const n = raw ? Number(raw) : 0;
                        setCiclos((prev) => {
                          const copy = [...prev];
                          copy[idx] = { ...copy[idx], ciclos: n };
                          return copy;
                        });
                      }}
                      inputMode="numeric"
                      disabled={!isStaff}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Dica: depois disso a gente gera o <b>relatório financeiro</b> (condomínio, valor, conta) e o Interno anexa o comprovante.
          </div>
        </div>
      </div>

      {/* MODAL: leitura base manual */}
      {needBase && isStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Leitura anterior não encontrada</div>
                <div className="mt-1 text-xs text-gray-600">
                  Isso acontece em condomínio novo ou histórico ainda vazio. Informe a leitura anterior/base para o cálculo do consumo deste mês.
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Condomínio: <b>{titulo}</b> • Mês: <b>{mesRef}</b> • Anterior: <b>{prevMes}</b>
                </div>
              </div>

              <button
                className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                onClick={() => setNeedBase(false)}
                disabled={savingBase}
              >
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

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <button
                className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setNeedBase(false)}
                disabled={savingBase}
              >
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

            <div className="mt-3 text-xs text-gray-500">
              Depois que o sistema tiver histórico, isso some: ele passa a usar automaticamente o mês anterior.
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
