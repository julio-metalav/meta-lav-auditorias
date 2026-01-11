"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function brl(n: number) {
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${Number(n ?? 0).toFixed(2)}`;
  }
}

type Linha = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number | null;
  quantidade: number;
  valor_ciclo: number;

  // vindo do banco (se existir)
  ciclos: number;
};

function linhaKey(l: Pick<Linha, "categoria" | "capacidade_kg">) {
  return `${l.categoria}::${l.capacidade_kg ?? "null"}`;
}

function labelLinha(l: Linha) {
  const cat = l.categoria === "lavadora" ? "Lavadora" : "Secadora";
  const cap = l.capacidade_kg ? `${l.capacidade_kg}kg` : "";
  const qtd = l.quantidade ? ` (qtd ${l.quantidade})` : "";
  return `${cat} ${cap}${qtd}`.trim();
}

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const auditoriaId = params.id;

  // 🚨 proteção contra /[id]
  if (!isUuid(auditoriaId)) {
    return (
      <div style={{ padding: 24 }}>
        <h2>ID de auditoria inválido</h2>
        <p style={{ marginTop: 8 }}>
          Esta página deve ser acessada a partir da lista de auditorias.
        </p>
        <button style={{ marginTop: 16 }} onClick={() => router.push("/auditorias")}>
          Voltar para Auditorias
        </button>
      </div>
    );
  }

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // resposta bruta da API (pra mostrar infos)
  const [raw, setRaw] = useState<any>(null);

  // linhas (maquinas + ciclos)
  const [linhas, setLinhas] = useState<Linha[]>([]);

  // estado do botão salvar ciclos
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // estado do botão finalizar
  const [finishing, setFinishing] = useState(false);
  const [finishedOk, setFinishedOk] = useState(false);

  // snapshot pra detectar mudança sem ficar comparando com raw
  const lastSavedRef = useRef<string>("");

  // ✅ tick pra forçar re-render quando lastSavedRef mudar (ref não re-renderiza)
  const [snapTick, setSnapTick] = useState(0);

  function serializeState(ls: Linha[]) {
    const obj: Record<string, number> = {};
    for (const l of ls) obj[linhaKey(l)] = Number(l.ciclos || 0);
    return JSON.stringify(obj);
  }

  async function load() {
    setLoading(true);
    setErr(null);
    setSavedOk(false);
    setFinishedOk(false);

    try {
      const r = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Erro ao carregar");

      setRaw(j);

      // Esperado: j.maquinas (tipos) + j.ciclos (lançados)
      const maquinas: any[] = j?.maquinas ?? [];
      const ciclos: any[] = j?.ciclos ?? [];

      // indexa ciclos por categoria/capacidade
      const idxCiclos = new Map<string, number>();
      for (const c of ciclos) {
        const k = `${c.categoria}::${c.capacidade_kg ?? "null"}`;
        idxCiclos.set(k, Number(c.ciclos ?? 0));
      }

      const ls: Linha[] = maquinas.map((m) => {
        const k = `${m.categoria}::${m.capacidade_kg ?? "null"}`;
        return {
          categoria: m.categoria,
          capacidade_kg: m.capacidade_kg ?? null,
          quantidade: Number(m.quantidade ?? 0),
          valor_ciclo: Number(m.valor_ciclo ?? 0),
          ciclos: idxCiclos.get(k) ?? 0,
        };
      });

      setLinhas(ls);

      const snap = serializeState(ls);
      lastSavedRef.current = snap;
      setSnapTick((t) => t + 1); // ✅ força dirty recalcular

      setLoading(false);
    } catch (e: any) {
      setErr(e.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditoriaId]);

  const totalEstimado = useMemo(() => {
    return linhas.reduce((acc, l) => acc + Number(l.ciclos || 0) * Number(l.valor_ciclo || 0), 0);
  }, [linhas]);

  const hasMaquinas = (raw?.maquinas?.length ?? 0) > 0;

  const dirty = useMemo(() => {
    const now = serializeState(linhas);
    return now !== lastSavedRef.current;
    // ✅ snapTick entra pra recalcular quando lastSavedRef mudar
  }, [linhas, snapTick]);

  async function salvar() {
    setErr(null);
    setSaving(true);
    setSavedOk(false);
    setFinishedOk(false);

    try {
      const payload = linhas.map((l) => ({
        categoria: l.categoria,
        capacidade_kg: l.capacidade_kg,
        ciclos: Number(l.ciclos || 0),
      }));

      const r = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Erro ao salvar");

      // ✅ atualiza snapshot e força dirty recalcular imediatamente
      lastSavedRef.current = serializeState(linhas);
      setSnapTick((t) => t + 1);

      setSavedOk(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function finalizar() {
    setErr(null);
    setFinishing(true);
    setFinishedOk(false);

    try {
      if (dirty) {
        throw new Error("Existem mudanças não salvas nos ciclos. Clique em Salvar antes de finalizar.");
      }

      const r = await fetch(`/api/auditorias/${auditoriaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "final", note: "Finalizado pelo interno" }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Erro ao finalizar");

      setFinishedOk(true);

      // Recarrega (pra refletir status na API / cache e qualquer regra extra)
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setFinishing(false);
    }
  }

  function setCiclos(i: number, v: string) {
    const rawv = v.replace(/[^\d]/g, "");
    const n = rawv === "" ? 0 : Number(rawv);
    setLinhas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ciclos: n } : l)));
    setSavedOk(false);
    setFinishedOk(false);
  }

  if (loading) return <div style={{ padding: 16 }}>Carregando…</div>;

  if (err) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Erro: {err}
        <br />
        <button onClick={load} style={{ marginTop: 8 }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <AppShell title="Auditoria (Interno)">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Lançar ciclos por tipo</div>
          <div className="small">Valor agregado (ciclos do mês por capacidade).</div>
          <div className="small" style={{ marginTop: 6 }}>
            ID: <code>{auditoriaId}</code>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Status atual: <b>{String(raw?.auditoria?.status ?? "—")}</b>
            {finishedOk && (
              <>
                {" "}
                • <b style={{ color: "green" }}>Finalizado ✅</b>
              </>
            )}
          </div>
        </div>

        <div className="row">
          <button className="btn" onClick={load} disabled={saving || finishing}>
            Recarregar
          </button>

          <button
            className={`btn ${dirty ? "primary" : ""}`}
            onClick={salvar}
            disabled={!dirty || saving || !hasMaquinas || finishing}
            title={!hasMaquinas ? "Cadastre o parque de máquinas do condomínio" : ""}
          >
            {saving ? "Salvando..." : savedOk && !dirty ? "Salvo ✅" : "Salvar"}
          </button>

          <button
            className={`btn ${!dirty && hasMaquinas ? "primary" : ""}`}
            onClick={finalizar}
            disabled={finishing || saving || dirty || !hasMaquinas}
            title={dirty ? "Salve os ciclos antes de finalizar" : !hasMaquinas ? "Cadastre máquinas" : ""}
          >
            {finishing ? "Finalizando..." : "Finalizar"}
          </button>

          <button
            className="btn"
            onClick={() => {
              router.refresh();
              router.push("/auditorias");
            }}
            disabled={saving}
          >
            Voltar
          </button>
        </div>
      </div>

      {!hasMaquinas && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700 }}>Nenhuma máquina cadastrada para este condomínio.</div>
          <div className="small" style={{ marginTop: 6 }}>
            Cadastre em: <code>/condominios/&lt;condominio_id&gt;/maquinas</code>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            (Agora também dá pra cadastrar direto em <code>/condominios</code> ao criar o ponto.)
          </div>
        </div>
      )}

      {hasMaquinas && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Ciclos por tipo</div>

          <div className="list">
            {linhas.map((l, i) => (
              <div key={linhaKey(l)} className="card" style={{ background: "#fff" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{labelLinha(l)}</div>
                    <div className="small" style={{ marginTop: 4 }}>
                      Valor por ciclo: <b>{brl(l.valor_ciclo)}</b>
                    </div>
                  </div>

                  <div style={{ minWidth: 220 }}>
                    <div className="small">Ciclos no mês</div>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(l.ciclos ?? 0)}
                      onChange={(e) => setCiclos(i, e.target.value)}
                      disabled={saving || finishing}
                    />
                    <div className="small" style={{ marginTop: 6 }}>
                      Estimado: <b>{brl(Number(l.ciclos || 0) * Number(l.valor_ciclo || 0))}</b>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <div>
              <div className="small">Total estimado</div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{brl(totalEstimado)}</div>
            </div>

            <div className="row">
              <button
                className={`btn ${dirty ? "primary" : ""}`}
                onClick={salvar}
                disabled={!dirty || saving || finishing}
              >
                {saving ? "Salvando..." : savedOk && !dirty ? "Salvo ✅" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, background: "#fbfcff" }}>
        <div style={{ fontWeight: 800 }}>Regras</div>
        <ul className="small" style={{ marginTop: 8, paddingLeft: 18 }}>
          <li>Interno pode finalizar auditoria (status: <code>final</code>).</li>
          <li>Para finalizar, os ciclos devem estar salvos.</li>
          <li>Relatórios gerenciais/sensíveis não são acessíveis ao Interno (isso fica fora desta tela).</li>
        </ul>
      </div>
    </AppShell>
  );
}
