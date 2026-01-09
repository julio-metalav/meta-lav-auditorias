"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Maquina = {
  id?: string;
  categoria: "lavadora" | "secadora";
  capacidade_kg: number;
  quantidade: number;
  valor_ciclo: number;
};

export default function MaquinasCondominioPage() {
  const params = useParams<{ id: string }>();
  const condominioId = params.id;

  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/condominios/${condominioId}/maquinas`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar máquinas");
      setMaquinas(json ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  function addLinha() {
    setMaquinas((m) => [
      ...m,
      {
        categoria: "lavadora",
        capacidade_kg: 10,
        quantidade: 0,
        valor_ciclo: 0,
      },
    ]);
  }

  function update(i: number, campo: keyof Maquina, valor: any) {
    setMaquinas((m) =>
      m.map((x, idx) => (idx === i ? { ...x, [campo]: valor } : x))
    );
  }

  async function salvar() {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(`/api/condominios/${condominioId}/maquinas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maquinas }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar");
      setOk("Máquinas salvas ✅");
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [condominioId]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Máquinas do Condomínio
      </h1>

      {err && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {ok && (
        <div className="mb-3 rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          {ok}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th>Tipo</th>
              <th>Capacidade (kg)</th>
              <th>Qtd</th>
              <th>Valor ciclo (R$)</th>
            </tr>
          </thead>
          <tbody>
            {maquinas.map((m, i) => (
              <tr key={i} className="border-t">
                <td>
                  <select
                    className="border rounded px-2 py-1"
                    value={m.categoria}
                    onChange={(e) =>
                      update(i, "categoria", e.target.value)
                    }
                  >
                    <option value="lavadora">Lavadora</option>
                    <option value="secadora">Secadora</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-24"
                    value={m.capacidade_kg}
                    onChange={(e) =>
                      update(i, "capacidade_kg", Number(e.target.value))
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-20"
                    value={m.quantidade}
                    onChange={(e) =>
                      update(i, "quantidade", Number(e.target.value))
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="border rounded px-2 py-1 w-28"
                    value={m.valor_ciclo}
                    onChange={(e) =>
                      update(i, "valor_ciclo", Number(e.target.value))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex gap-3">
          <button
            className="rounded-xl border px-4 py-2 text-sm"
            onClick={addLinha}
          >
            + Adicionar máquina
          </button>

          <button
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white font-semibold disabled:opacity-50"
            onClick={salvar}
            disabled={saving || loading}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
