"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Maquina = {
  id?: string;
  condominio_id?: string;
  categoria: "lavadora" | "secadora";
  capacidade_kg: number | null;
  quantidade: number;
  valor_ciclo: number;
};

function brl(n: number) {
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${Number(n ?? 0).toFixed(2)}`;
  }
}

function num(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CondominioMaquinasPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const condominioId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<Maquina[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch(`/api/condominios/${condominioId}/maquinas`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Erro ao carregar");

      const maquinas = (j?.maquinas ?? []) as any[];

      const normalized: Maquina[] = maquinas.map((m) => ({
        id: m.id,
        condominio_id: m.condominio_id,
        categoria: (m.categoria ?? "lavadora") as "lavadora" | "secadora",
        capacidade_kg: m.capacidade_kg === null || m.capacidade_kg === undefined ? null : Number(m.capacidade_kg),
        quantidade: Number(m.quantidade ?? 0),
        valor_ciclo: Number(m.valor_ciclo ?? 0),
      }));

      setRows(normalized.length ? normalized : []);
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condominioId]);

  function addRow() {
    setRows((prev) => [
      ...prev,
      { categoria: "lavadora", capacidade_kg: 10, quantidade: 1, valor_ciclo: 0 },
    ]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, patch: Partial<Maquina>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const totalMaquinas = useMemo(() => rows.reduce((acc, r) => acc + num(r.quantidade, 0), 0), [rows]);

  const totalLavadoras = useMemo(
    () => rows.filter((r) => r.categoria === "lavadora").reduce((acc, r) => acc + num(r.quantidade, 0), 0),
    [rows]
  );

  const totalSecadoras = useMemo(
    () => rows.filter((r) => r.categoria === "secadora").reduce((acc, r) => acc + num(r.quantidade, 0), 0),
    [rows]
  );

  async function salvar() {
    setSaving(true);
    setErr(null);
    setOkMsg(null);

    try {
      if (rows.length === 0) {
        throw new Error("Adicione pelo menos 1 tipo de máquina.");
      }

      // validação mínima
      for (const r of rows) {
        if (!r.categoria) throw new Error("categoria é obrigatória");
        if (r.capacidade_kg !== null && !Number.isFinite(Number(r.capacidade_kg))) throw new Error("capacidade_kg inválida");
        if (!Number.isFinite(Number(r.quantidade)) || Number(r.quantidade) < 0) throw new Error("quantidade inválida");
        if (!Number.isFinite(Number(r.valor_ciclo)) || Number(r.valor_ciclo) < 0) throw new Error("valor_ciclo inválido");
      }

      const payload = rows.map((r) => ({
        categoria: r.categoria,
        capacidade_kg: r.capacidade_kg === null ? null : Number(r.capacidade_kg),
        quantidade: Number(r.quantidade),
        valor_ciclo: Number(r.valor_ciclo),
      }));

      const res = await fetch(`/api/condominios/${condominioId}/maquinas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Erro ao salvar");

      setOkMsg("Salvo ✅");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Carregando…</div>;

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: 6 }}>Parque de máquinas</h1>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
        Condomínio: <code>{condominioId}</code>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button
          onClick={() => router.push("/auditorias")}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc" }}
        >
          Voltar
        </button>

        <button
          onClick={addRow}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc" }}
        >
          + Adicionar tipo
        </button>

        <button
          onClick={salvar}
          disabled={saving}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>

        {okMsg && <div style={{ alignSelf: "center", color: "green" }}>{okMsg}</div>}
        {err && <div style={{ alignSelf: "center", color: "crimson" }}>Erro: {err}</div>}
      </div>

      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div><strong>Total máquinas:</strong> {totalMaquinas}</div>
        <div><strong>Lavadoras:</strong> {totalLavadoras}</div>
        <div><strong>Secadoras:</strong> {totalSecadoras}</div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          Nenhuma máquina cadastrada ainda. Clique em <strong>+ Adicionar tipo</strong>.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r, i) => (
            <div
              key={`${r.categoria}-${r.capacidade_kg}-${i}`}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "160px 160px 160px 160px auto",
                gap: 10,
                alignItems: "end",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Categoria</span>
                <select
                  value={r.categoria}
                  onChange={(e) => updateRow(i, { categoria: e.target.value as any })}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ccc" }}
                >
                  <option value="lavadora">Lavadora</option>
                  <option value="secadora">Secadora</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Capacidade (kg)</span>
                <input
                  inputMode="numeric"
                  value={r.capacidade_kg === null ? "" : String(r.capacidade_kg)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d.]/g, "");
                    updateRow(i, { capacidade_kg: raw === "" ? null : Number(raw) });
                  }}
                  placeholder="ex: 10"
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ccc" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Quantidade</span>
                <input
                  inputMode="numeric"
                  value={String(r.quantidade ?? 0)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, "");
                    updateRow(i, { quantidade: raw === "" ? 0 : Number(raw) });
                  }}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ccc" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Valor por ciclo</span>
                <input
                  inputMode="decimal"
                  value={String(r.valor_ciclo ?? 0)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
                    updateRow(i, { valor_ciclo: raw === "" ? 0 : Number(raw) });
                  }}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ccc" }}
                />
                <span style={{ fontSize: 12, opacity: 0.7 }}>{brl(num(r.valor_ciclo, 0))}</span>
              </label>

              <button
                onClick={() => removeRow(i)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
