"use client";

import { useEffect, useMemo, useState } from "react";

type LinhaUI = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number;
  quantidade: number;
  valor_ciclo: number;
  ciclos: number; // total do tipo no mês
};

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [linhas, setLinhas] = useState<LinhaUI[]>([]);
  const [salvo, setSalvo] = useState(true);

  const totalReceita = useMemo(() => {
    return linhas.reduce((acc, l) => acc + (Number(l.ciclos || 0) * Number(l.valor_ciclo || 0)), 0);
  }, [linhas]);

  function setLinha(i: number, ciclos: number) {
    setLinhas((prev) => prev.map((x, idx) => (idx === i ? { ...x, ciclos } : x)));
    setSalvo(false);
  }

  async function carregar() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const res = await fetch(`/api/auditorias/${id}/ciclos`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar");

      const maquinas = Array.isArray(json?.maquinas) ? json.maquinas : [];
      const ciclos = Array.isArray(json?.ciclos) ? json.ciclos : [];

      const mapCiclos = new Map<string, number>();
      ciclos.forEach((c: any) => {
        mapCiclos.set(`${c.categoria}|${c.capacidade_kg}`, Number(c.ciclos ?? 0));
      });

      const ui: LinhaUI[] = maquinas.map((m: any) => ({
        categoria: m.categoria,
        capacidade_kg: Number(m.capacidade_kg),
        quantidade: Number(m.quantidade ?? 0),
        valor_ciclo: Number(m.valor_ciclo ?? 0),
        ciclos: mapCiclos.get(`${m.categoria}|${m.capacidade_kg}`) ?? 0,
      }));

      setLinhas(ui);
      setSalvo(true);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function salvar() {
    setErr(null);
    setOk(null);
    setSaving(true);

    try {
      const payload = {
        linhas: linhas.map((l) => ({
          categoria: l.categoria,
          capacidade_kg: l.capacidade_kg,
          ciclos: Number(l.ciclos ?? 0),
        })),
      };

      const res = await fetch(`/api/auditorias/${id}/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar ciclos");

      setOk("Ciclos salvos ✅");
      setSalvo(true);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria (Interno)</h1>
          <div className="mt-1 font-mono text-xs text-gray-400">ID: {id}</div>
          <div className="mt-1 text-sm text-gray-600">
            Lançar <b>ciclos por tipo</b> (valor agregado).
          </div>
        </div>

        <button
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={carregar}
          disabled={loading || saving}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {ok}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-700">Ciclos por máquina (agregado)</div>

        {linhas.length === 0 ? (
          <div className="text-sm text-gray-600">
            Nenhuma máquina cadastrada para este condomínio.
            <br />
            Cadastre em: <span className="font-mono">/condominios/&lt;id&gt;/maquinas</span>
          </div>
        ) : (
          <div className="space-y-3">
            {linhas.map((l, i) => (
              <div key={`${l.categoria}-${l.capacidade_kg}`} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {l.categoria === "lavadora" ? "Lavadora" : "Secadora"} • {l.capacidade_kg}kg
                  </div>
                  <div className="text-xs text-gray-500">
                    Qtd: <b>{l.quantidade}</b> • Valor ciclo: <b>R$ {l.valor_ciclo.toFixed(2)}</b>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Ciclos no mês (TOTAL do tipo)</label>
                    <input
                      type="number"
                      className="w-full rounded-xl border px-3 py-2"
                      value={l.ciclos}
                      onChange={(e) => setLinha(i, Number(e.target.value))}
                      placeholder="ex: 320"
                      min={0}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-gray-600">Receita estimada do tipo</label>
                    <div className="w-full rounded-xl border px-3 py-2 bg-gray-50 text-sm">
                      R$ {(Number(l.ciclos || 0) * Number(l.valor_ciclo || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            Total estimado: <b>R$ {totalReceita.toFixed(2)}</b>
          </div>

          <div className="flex gap-3">
            <button
              className={`rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-50 ${
                salvo ? "bg-green-600 text-white" : "bg-gray-300 text-gray-800"
              }`}
              onClick={salvar}
              disabled={saving || loading || salvo}
            >
              {saving ? "Salvando..." : salvo ? "Salvo" : "Salvar"}
            </button>

            <a className="rounded-xl border px-5 py-2 text-sm hover:bg-gray-50" href="/auditorias">
              Voltar
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
