"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  mes_ref?: string | null;
  ano_mes?: string | null;
  status: string | null;

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  observacoes?: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;
  foto_quimicos_url?: string | null;
  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  comprovante_fechamento_url?: string | null;

  created_at?: string | null;
  updated_at?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null; role?: Role | null } | null;
};

type CondoMaquina = {
  id: string;
  condominio_id: string;
  tag: string; // ex: LAV-10-01
  tipo: string; // ex: lavadora 10kg
};

type CicloItem = {
  maquina_id: string;
  maquina_tag: string;
  tipo: string;
  ciclos: number;
};

type FechamentoItem = {
  id?: string;
  auditoria_id?: string;
  maquina_tag: string;
  tipo?: string | null;
  ciclos: number;
  valor_total?: number;
  valor_repasse?: number;
  valor_cashback?: number;
  observacoes?: string | null;
};

function toList<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload?.data && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return s || "aberta";
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function calcConsumo(atual: number | null | undefined, base: number | null | undefined) {
  const a = safeNum(atual);
  const b = safeNum(base);
  if (!a || !b) return null;
  return a - b;
}

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const auditoriaId = params.id;

  const [aud, setAud] = useState<Aud | null>(null);
  const [maquinas, setMaquinas] = useState<CondoMaquina[]>([]);
  const [ciclos, setCiclos] = useState<CicloItem[]>([]);
  const [fechamento, setFechamento] = useState<FechamentoItem[]>([]);
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);
  const [savingFechamento, setSavingFechamento] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [baseModalOpen, setBaseModalOpen] = useState(false);
  const [base, setBase] = useState<{ agua: string; energia: string; gas: string }>({ agua: "", energia: "", gas: "" });

  const isFinal = normalizeStatus(aud?.status) === "final";

  const totalCiclos = useMemo(() => ciclos.reduce((s, x) => s + safeNum(x.ciclos), 0), [ciclos]);

  async function carregarTudo() {
    setLoading(true);
    setErr(null);

    try {
      // 1) auditoria (dados do mês)
      const aRes = await fetch(`/api/auditorias/${auditoriaId}`, { cache: "no-store" });
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson?.error ?? "Falha ao carregar auditoria");
      const audRow = aJson?.data ?? aJson ?? null;
      setAud(audRow);

      // 2) máquinas do condomínio
      const cId = audRow?.condominio_id;
      if (!cId) throw new Error("Auditoria sem condominio_id");
      const mRes = await fetch(`/api/condominios/${cId}/maquinas`, { cache: "no-store" });
      const mJson = await mRes.json();
      if (!mRes.ok) throw new Error(mJson?.error ?? "Falha ao carregar máquinas");
      const mList = toList<CondoMaquina>(mJson);
      setMaquinas(mList);

      // 3) ciclos por máquina
      const ciclosRes = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, { cache: "no-store" });
      const ciclosJson = await ciclosRes.json();
      if (!ciclosRes.ok) throw new Error(ciclosJson?.error ?? "Falha ao carregar ciclos");
      const cicloList = toList<CicloItem>(ciclosJson?.itens ?? ciclosJson);
      const normalized = cicloList.map((it) => ({
        maquina_id: it.maquina_id,
        maquina_tag: it.maquina_tag,
        tipo: it.tipo,
        ciclos: safeNum(it.ciclos),
      }));
      setCiclos(normalized.filter((x) => x.maquina_tag));

      await carregarFechamento();
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function salvarBaseLeitura() {
    setErr(null);
    try {
      const payload = {
        agua_base: base.agua ? safeNum(base.agua) : null,
        energia_base: base.energia ? safeNum(base.energia) : null,
        gas_base: base.gas ? safeNum(base.gas) : null,
      };

      const res = await fetch(`/api/auditorias/${auditoriaId}/base`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao salvar base");
      setBaseModalOpen(false);
      await carregarTudo();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar base");
    }
  }

  async function salvarCiclos() {
    setErr(null);
    try {
      const res = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: ciclos }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao salvar ciclos");

      await carregarTudo();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar ciclos");
    }
  }

  async function carregarFechamento() {
    try {
      const res = await fetch(`/api/auditorias/${auditoriaId}/fechamento`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao carregar relatório financeiro");
      setFechamento(Array.isArray(json?.itens) ? json.itens : []);
      setComprovanteUrl(json?.auditoria?.comprovante_fechamento_url ?? null);
    } catch (e: any) {
      // não trava a tela principal
      console.error(e);
    }
  }

  async function gerarItensRelatorio() {
    if (!ciclos.length) return;
    setSavingFechamento(true);
    setErr(null);

    try {
      // só gera se ainda não existir nada (pra não sobrescrever valores)
      if (fechamento.length) return;

      for (const it of ciclos) {
        const res = await fetch(`/api/auditorias/${auditoriaId}/fechamento`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maquina_tag: it.maquina_tag,
            tipo: it.tipo,
            ciclos: it.ciclos,
            valor_total: 0,
            valor_repasse: 0,
            valor_cashback: 0,
            observacoes: null,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Falha ao gerar itens do relatório");
      }

      await carregarFechamento();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao gerar itens do relatório");
    } finally {
      setSavingFechamento(false);
    }
  }

  async function salvarRelatorio() {
    setSavingFechamento(true);
    setErr(null);

    try {
      for (const it of fechamento) {
        const res = await fetch(`/api/auditorias/${auditoriaId}/fechamento`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: it.id,
            maquina_tag: it.maquina_tag,
            tipo: it.tipo,
            ciclos: it.ciclos,
            valor_total: Number(it.valor_total ?? 0),
            valor_repasse: Number(it.valor_repasse ?? 0),
            valor_cashback: Number(it.valor_cashback ?? 0),
            observacoes: it.observacoes ?? null,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Falha ao salvar relatório");
      }

      await carregarFechamento();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar relatório");
    } finally {
      setSavingFechamento(false);
    }
  }

  async function uploadComprovante(file: File) {
    setErr(null);

    const fd = new FormData();
    fd.append("kind", "comprovante_fechamento");
    fd.append("file", file);

    const res = await fetch(`/api/auditorias/${auditoriaId}/fotos`, {
      method: "POST",
      body: fd,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error ?? "Falha ao enviar comprovante");
    }

    const url = json?.url ?? json?.publicUrl ?? json?.data?.publicUrl ?? null;
    if (url) setComprovanteUrl(url);

    await carregarFechamento();
  }

  async function finalizarMes() {
    setFinalizando(true);
    setErr(null);

    try {
      const res = await fetch(`/api/auditorias/${auditoriaId}/fechamento`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprovante_fechamento_url: comprovanteUrl,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao finalizar mês");

      await carregarTudo();
      await carregarFechamento();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao finalizar mês");
    } finally {
      setFinalizando(false);
    }
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditoriaId]);

  const mes = (aud?.mes_ref ?? aud?.ano_mes ?? monthISO()) as string;

  // leitura base (vinda do backend em /fechamento GET). aqui a tela só calcula, não armazena.
  // modal de base escreve em /api/auditorias/[id]/base.
  const aguaAtual = safeNum(aud?.agua_leitura);
  const energiaAtual = safeNum(aud?.energia_leitura);
  const gasAtual = safeNum(aud?.gas_leitura);

  // card “consumo calculado”: a base real vem do endpoint /fechamento (ele calcula com mês anterior ou base informada).
  // Por enquanto, manter a UI simples e usar o texto “Base: informada manualmente” como já estava na sua tela.
  // (O backend é quem garante se existe histórico/base.)

  return (
    <AppShell>
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, color: "#666" }}>Auditoria (Interno)</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>Fechamento (Interno)</h1>
            <div style={{ color: "#666", marginTop: 6 }}>
              <span style={{ fontFamily: "monospace" }}>{aud?.condominio_id ?? "-"}</span>
            </div>
            <div style={{ color: "#666", marginTop: 6 }}>
              Mês: <b>{mes}</b> · ID: <span style={{ fontFamily: "monospace" }}>{auditoriaId}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={carregarTudo}
              style={{
                padding: "10px 16px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
                cursor: "pointer",
              }}
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>
            <button
              onClick={() => history.back()}
              style={{
                padding: "10px 16px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
                cursor: "pointer",
              }}
            >
              Voltar
            </button>
          </div>
        </div>

        {err ? (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f1", color: "#b00020" }}>
            {err}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 18,
            padding: 18,
            border: "1px solid #e6e6e6",
            borderRadius: 16,
            background: "white",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Consumo do mês (calculado)</div>
            <button
              onClick={() => setBaseModalOpen(true)}
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #d8d8d8",
                background: "white",
                cursor: "pointer",
              }}
            >
              Definir leitura base
            </button>
          </div>

          <div style={{ color: "#666", marginTop: 6 }}>Base: informada manualmente</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}>
            <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 800 }}>Água</div>
              <div style={{ marginTop: 6 }}>Atual: <b>{aguaAtual || "-"}</b></div>
              <div>Base: <b>1</b></div>
              <div>Consumo: <b>{calcConsumo(aguaAtual, 1) ?? "-"}</b></div>
            </div>

            <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 800 }}>Energia</div>
              <div style={{ marginTop: 6 }}>Atual: <b>{energiaAtual || "-"}</b></div>
              <div>Base: <b>1</b></div>
              <div>Consumo: <b>{calcConsumo(energiaAtual, 1) ?? "-"}</b></div>
            </div>

            <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 800 }}>Gás</div>
              <div style={{ marginTop: 6 }}>Atual: <b>{gasAtual || "-"}</b></div>
              <div>Base: <b>1</b></div>
              <div>Consumo: <b>{calcConsumo(gasAtual, 1) ?? "-"}</b></div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 18,
            border: "1px solid #e6e6e6",
            borderRadius: 16,
            background: "white",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Ciclos por máquina</div>
              <div style={{ color: "#666", marginTop: 4 }}>
                O Interno lança ciclos por máquina individual. A lista vem do cadastro do condomínio (condominio_maquinas).
              </div>
            </div>

            <button
              onClick={salvarCiclos}
              disabled={isFinal}
              style={{
                padding: "10px 16px",
                borderRadius: 14,
                border: "none",
                background: "#1f6feb",
                color: "white",
                fontWeight: 900,
                cursor: "pointer",
                opacity: isFinal ? 0.5 : 1,
              }}
            >
              Salvar ciclos
            </button>
          </div>

          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "10px 8px" }}>Máquina</th>
                  <th style={{ padding: "10px 8px" }}>Tipo</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Ciclos</th>
                </tr>
              </thead>

              <tbody>
                {ciclos.map((m) => (
                  <tr key={m.maquina_id} style={{ borderBottom: "1px solid #f3f3f3" }}>
                    <td style={{ padding: "10px 8px", fontWeight: 700 }}>{m.maquina_tag}</td>
                    <td style={{ padding: "10px 8px", color: "#666" }}>{m.tipo}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      <input
                        type="number"
                        value={m.ciclos}
                        disabled={isFinal}
                        onChange={(e) => {
                          const v = safeNum(e.target.value);
                          setCiclos((arr) => arr.map((x) => (x.maquina_id === m.maquina_id ? { ...x, ciclos: v } : x)));
                        }}
                        style={{
                          width: 90,
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: "1px solid #ddd",
                          textAlign: "right",
                          opacity: isFinal ? 0.6 : 1,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr>
                  <td style={{ padding: "10px 8px", fontWeight: 900 }} colSpan={2}>
                    Total
                  </td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900 }}>{totalCiclos}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 10, color: "#666" }}>
            Próximo: gerar o <b>relatório financeiro</b> (condomínio, valor, conta) e anexar o comprovante.
          </div>
        </div>

        {/* RELATÓRIO FINANCEIRO */}
        <div
          style={{
            marginTop: 18,
            padding: 18,
            border: "1px solid #e6e6e6",
            borderRadius: 16,
            background: "white",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Relatório financeiro</div>
              <div style={{ color: "#666", marginTop: 4 }}>Preencha valores, anexe comprovante e finalize o mês.</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {fechamento.length === 0 ? (
                <button
                  onClick={gerarItensRelatorio}
                  disabled={savingFechamento || ciclos.length === 0 || isFinal}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid #d8d8d8",
                    background: "white",
                    cursor: "pointer",
                    opacity: savingFechamento || ciclos.length === 0 || isFinal ? 0.6 : 1,
                  }}
                >
                  {savingFechamento ? "Gerando..." : "Gerar itens"}
                </button>
              ) : null}

              <button
                onClick={salvarRelatorio}
                disabled={savingFechamento || fechamento.length === 0 || isFinal}
                style={{
                  padding: "10px 14px",
                  borderRadius: 14,
                  border: "none",
                  background: "#1f6feb",
                  color: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                  opacity: savingFechamento || fechamento.length === 0 || isFinal ? 0.6 : 1,
                }}
              >
                {savingFechamento ? "Salvando..." : "Salvar relatório"}
              </button>
            </div>
          </div>

          {fechamento.length === 0 ? (
            <div style={{ marginTop: 14, color: "#666" }}>
              Nenhum item ainda. Clique em <b>Gerar itens</b> (depois de salvar ciclos) para criar o relatório por
              máquina.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 14, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                      <th style={{ padding: "10px 8px" }}>Máquina</th>
                      <th style={{ padding: "10px 8px" }}>Tipo</th>
                      <th style={{ padding: "10px 8px" }}>Ciclos</th>
                      <th style={{ padding: "10px 8px" }}>Valor total</th>
                      <th style={{ padding: "10px 8px" }}>Repasse</th>
                      <th style={{ padding: "10px 8px" }}>Cashback</th>
                      <th style={{ padding: "10px 8px" }}>Obs.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fechamento.map((it) => (
                      <tr key={it.maquina_tag} style={{ borderBottom: "1px solid #f3f3f3" }}>
                        <td style={{ padding: "10px 8px", fontWeight: 700 }}>{it.maquina_tag}</td>
                        <td style={{ padding: "10px 8px", color: "#666" }}>{it.tipo ?? "-"}</td>
                        <td style={{ padding: "10px 8px" }}>{it.ciclos}</td>
                        <td style={{ padding: "10px 8px" }}>
                          <input
                            type="number"
                            value={it.valor_total ?? 0}
                            disabled={isFinal}
                            onChange={(e) =>
                              setFechamento((arr) =>
                                arr.map((x) =>
                                  x.maquina_tag === it.maquina_tag ? { ...x, valor_total: Number(e.target.value) } : x
                                )
                              )
                            }
                            style={{
                              width: 120,
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid #ddd",
                              opacity: isFinal ? 0.6 : 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <input
                            type="number"
                            value={it.valor_repasse ?? 0}
                            disabled={isFinal}
                            onChange={(e) =>
                              setFechamento((arr) =>
                                arr.map((x) =>
                                  x.maquina_tag === it.maquina_tag
                                    ? { ...x, valor_repasse: Number(e.target.value) }
                                    : x
                                )
                              )
                            }
                            style={{
                              width: 120,
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid #ddd",
                              opacity: isFinal ? 0.6 : 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <input
                            type="number"
                            value={it.valor_cashback ?? 0}
                            disabled={isFinal}
                            onChange={(e) =>
                              setFechamento((arr) =>
                                arr.map((x) =>
                                  x.maquina_tag === it.maquina_tag
                                    ? { ...x, valor_cashback: Number(e.target.value) }
                                    : x
                                )
                              )
                            }
                            style={{
                              width: 120,
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid #ddd",
                              opacity: isFinal ? 0.6 : 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <input
                            value={it.observacoes ?? ""}
                            disabled={isFinal}
                            onChange={(e) =>
                              setFechamento((arr) =>
                                arr.map((x) =>
                                  x.maquina_tag === it.maquina_tag ? { ...x, observacoes: e.target.value } : x
                                )
                              )
                            }
                            style={{
                              width: 240,
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid #ddd",
                              opacity: isFinal ? 0.6 : 1,
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", color: "#333" }}>
                <div>
                  <b>Total:</b> {fechamento.reduce((s, x) => s + Number(x.valor_total ?? 0), 0).toFixed(2)}
                </div>
                <div>
                  <b>Repasse:</b> {fechamento.reduce((s, x) => s + Number(x.valor_repasse ?? 0), 0).toFixed(2)}
                </div>
                <div>
                  <b>Cashback:</b> {fechamento.reduce((s, x) => s + Number(x.valor_cashback ?? 0), 0).toFixed(2)}
                </div>
              </div>

              <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Comprovante</div>
                  {comprovanteUrl ? (
                    <div style={{ marginBottom: 6 }}>
                      <a href={comprovanteUrl} target="_blank" rel="noreferrer">
                        Ver comprovante
                      </a>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 6, color: "#666" }}>Ainda não anexado.</div>
                  )}

                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={isFinal}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        await uploadComprovante(f);
                      } catch (err2: any) {
                        setErr(err2?.message ?? "Erro ao enviar comprovante");
                      } finally {
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "end" }}>
                  <button
                    onClick={finalizarMes}
                    disabled={finalizando || !comprovanteUrl || fechamento.length === 0 || isFinal}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: "none",
                      background: "#16a34a",
                      color: "white",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: finalizando || !comprovanteUrl || fechamento.length === 0 || isFinal ? 0.6 : 1,
                    }}
                  >
                    {finalizando ? "Finalizando..." : "Finalizar mês"}
                  </button>
                </div>
              </div>

              {isFinal ? <div style={{ marginTop: 12, color: "#16a34a", fontWeight: 800 }}>Auditoria finalizada.</div> : null}
            </>
          )}
        </div>

        {/* MODAL BASE */}
        {baseModalOpen ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
              zIndex: 50,
            }}
          >
            <div style={{ width: 520, maxWidth: "100%", background: "white", borderRadius: 18, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Leitura anterior não encontrada</div>
                  <div style={{ marginTop: 6, color: "#666" }}>
                    Condomínio novo ou histórico vazio. Informe a leitura anterior/base para o cálculo do consumo do mês.
                  </div>
                  <div style={{ marginTop: 6, color: "#666" }}>
                    Condomínio: <span style={{ fontFamily: "monospace" }}>{aud?.condominio_id ?? "-"}</span> · Mês:{" "}
                    {mes}
                  </div>
                </div>

                <button
                  onClick={() => setBaseModalOpen(false)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid #d8d8d8",
                    background: "white",
                    cursor: "pointer",
                    height: 42,
                  }}
                >
                  Fechar
                </button>
              </div>

              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Água (base)</div>
                  <input
                    value={base.agua}
                    onChange={(e) => setBase((b) => ({ ...b, agua: e.target.value }))}
                    placeholder="ex: 12345"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 14, border: "1px solid #ddd" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Energia (base)</div>
                  <input
                    value={base.energia}
                    onChange={(e) => setBase((b) => ({ ...b, energia: e.target.value }))}
                    placeholder="ex: 67890"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 14, border: "1px solid #ddd" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Gás (base)</div>
                  <input
                    value={base.gas}
                    onChange={(e) => setBase((b) => ({ ...b, gas: e.target.value }))}
                    placeholder="se não tiver, vazio"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 14, border: "1px solid #ddd" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", justifyContent: "end", gap: 10 }}>
                <button
                  onClick={() => setBaseModalOpen(false)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid #d8d8d8",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>

                <button
                  onClick={salvarBaseLeitura}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "none",
                    background: "#16a34a",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Salvar base
                </button>
              </div>

              <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
                Depois que tiver histórico, isso some: o sistema usa automaticamente o mês anterior.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
