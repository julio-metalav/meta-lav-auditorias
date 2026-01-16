"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;

  tipo_pagamento?: "direto" | "boleto" | null;
};

type Me = { user: { id: string; email: string }; role: string };

type MaquinaRow = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number | null;
  quantidade: number;

  // input livre (16,50)
  valor_ciclo_text: string;

  // regras limpeza
  limpeza_quimica_ciclos: number;
  limpeza_mecanica_ciclos: number;
};

function brl(n: number) {
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${Number(n ?? 0).toFixed(2)}`;
  }
}

/** Aceita "16,50" ou "16.50" ou "1.234,56" e devolve number */
function parseMoneyPtBr(input: string): number {
  const s = String(input ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/^R\$/i, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Formata para pt-BR com 2 casas e vírgula */
function formatMoneyPtBr(n: number): string {
  const fixed = Number(n ?? 0).toFixed(2);
  return fixed.replace(".", ",");
}

function clampPosInt(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i > 0 ? i : fallback;
}

function badgePagamento(tipo?: string | null) {
  const t = String(tipo ?? "direto").toLowerCase();
  const label = t === "boleto" ? "Boleto" : "Direto";
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #d0d5dd",
        background: "#f9fafb",
      }}
    >
      {label}
    </span>
  );
}

export default function CondominiosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState<any>({
    nome: "",
    cidade: "",
    uf: "",
    cep: "",
    rua: "",
    numero: "",
    bairro: "",
    complemento: "",
    sindico_nome: "",
    sindico_telefone: "",
    zelador_nome: "",
    zelador_telefone: "",
    valor_ciclo_lavadora: "",
    valor_ciclo_secadora: "",
    cashback_percent: "",

    // ✅ NOVO: tarifas para cálculo de repasse por consumo
    agua_valor_m3: "",
    energia_valor_kwh: "",
    gas_valor_m3: "",

    banco: "",
    agencia: "",
    conta: "",
    tipo_conta: "",
    pix: "",
    favorecido_cnpj: "",
    tipo_pagamento: "direto",
  });

  // Parque de máquinas embutido no cadastro
  const [maquinas, setMaquinas] = useState<MaquinaRow[]>([
    {
      categoria: "lavadora",
      capacidade_kg: 10,
      quantidade: 1,
      valor_ciclo_text: "0,00",
      limpeza_quimica_ciclos: 500,
      limpeza_mecanica_ciclos: 2000,
    },
  ]);

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
    setOk(null);

    const [m, c] = await Promise.all([fetch("/api/me").then((r) => r.json()), fetch("/api/condominios").then((r) => r.json())]);

    if (m?.error) {
      setErr(m.error);
      return;
    }
    setMe(m);

    if (c?.error) {
      setErr(c.error);
      return;
    }
    setCondos(c.data || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const mapsUrl = useMemo(() => {
    const parts = [form.rua, form.numero, form.bairro, form.cidade, form.uf, form.cep]
      .map((x: string) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");
    return parts ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}` : "";
  }, [form]);

  function addMaquina() {
    setMaquinas((prev) => [
      ...prev,
      {
        categoria: "lavadora",
        capacidade_kg: 10,
        quantidade: 1, // ✅ default seguro
        valor_ciclo_text: "0,00",
        limpeza_quimica_ciclos: 500,
        limpeza_mecanica_ciclos: 2000,
      },
    ]);
  }

  function removeMaquina(i: number) {
    setMaquinas((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateMaquina(i: number, patch: Partial<MaquinaRow>) {
    setMaquinas((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const maquinasResumo = useMemo(() => {
    const total = maquinas.reduce((acc, m) => acc + (Number(m.quantidade) || 0), 0);
    const lav = maquinas.filter((m) => m.categoria === "lavadora").reduce((acc, m) => acc + (Number(m.quantidade) || 0), 0);
    const sec = maquinas.filter((m) => m.categoria === "secadora").reduce((acc, m) => acc + (Number(m.quantidade) || 0), 0);
    return { total, lav, sec };
  }, [maquinas]);

  function resetForm() {
    setForm({
      nome: "",
      cidade: "",
      uf: "",
      cep: "",
      rua: "",
      numero: "",
      bairro: "",
      complemento: "",
      sindico_nome: "",
      sindico_telefone: "",
      zelador_nome: "",
      zelador_telefone: "",
      valor_ciclo_lavadora: "",
      valor_ciclo_secadora: "",
      cashback_percent: "",

      // ✅ NOVO
      agua_valor_m3: "",
      energia_valor_kwh: "",
      gas_valor_m3: "",

      banco: "",
      agencia: "",
      conta: "",
      tipo_conta: "",
      pix: "",
      favorecido_cnpj: "",
      tipo_pagamento: "direto",
    });

    setMaquinas([
      {
        categoria: "lavadora",
        capacidade_kg: 10,
        quantidade: 1,
        valor_ciclo_text: "0,00",
        limpeza_quimica_ciclos: 500,
        limpeza_mecanica_ciclos: 2000,
      },
    ]);
  }

  async function criar() {
    setErr(null);
    setOk(null);
    setSaving(true);

    try {
      if (!form.nome || !form.cidade || !form.uf) {
        throw new Error("Preencha Nome, Cidade e UF.");
      }

      if (!maquinas.length) throw new Error("Cadastre pelo menos 1 tipo de máquina.");

      // ✅ REGRA: precisa ter quantidade > 0
      for (let idx = 0; idx < maquinas.length; idx++) {
        const m = maquinas[idx];

        if (!m.categoria) throw new Error(`Linha ${idx + 1}: Categoria da máquina é obrigatória.`);
        if (m.capacidade_kg !== null && !Number.isFinite(Number(m.capacidade_kg))) throw new Error(`Linha ${idx + 1}: Capacidade (kg) inválida.`);
        if (!Number.isFinite(Number(m.quantidade)) || Number(m.quantidade) <= 0) throw new Error(`Linha ${idx + 1}: Quantidade deve ser maior que zero.`);
        const val = parseMoneyPtBr(m.valor_ciclo_text);
        if (!Number.isFinite(val) || val < 0) throw new Error(`Linha ${idx + 1}: Valor por ciclo inválido.`);
        if (!Number.isFinite(Number(m.limpeza_quimica_ciclos)) || Number(m.limpeza_quimica_ciclos) <= 0)
          throw new Error(`Linha ${idx + 1}: Limpeza química (ciclos) inválida.`);
        if (!Number.isFinite(Number(m.limpeza_mecanica_ciclos)) || Number(m.limpeza_mecanica_ciclos) <= 0)
          throw new Error(`Linha ${idx + 1}: Limpeza mecânica (ciclos) inválida.`);
      }

      const payload: any = { ...form };

      payload.valor_ciclo_lavadora = payload.valor_ciclo_lavadora ? parseMoneyPtBr(String(payload.valor_ciclo_lavadora)) : null;
      payload.valor_ciclo_secadora = payload.valor_ciclo_secadora ? parseMoneyPtBr(String(payload.valor_ciclo_secadora)) : null;
      payload.cashback_percent = payload.cashback_percent ? Number(payload.cashback_percent) : null;

      // ✅ NOVO: tarifas (repasse)
      payload.agua_valor_m3 = payload.agua_valor_m3 ? parseMoneyPtBr(String(payload.agua_valor_m3)) : null;
      payload.energia_valor_kwh = payload.energia_valor_kwh ? parseMoneyPtBr(String(payload.energia_valor_kwh)) : null;
      payload.gas_valor_m3 = payload.gas_valor_m3 ? parseMoneyPtBr(String(payload.gas_valor_m3)) : null;

      payload.tipo_pagamento = String(payload.tipo_pagamento ?? "direto").toLowerCase() === "boleto" ? "boleto" : "direto";

      const r = await fetch("/api/condominios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Erro ao salvar condomínio");

      const condominioId: string | undefined = j?.data?.id ?? j?.id ?? j?.condominio?.id ?? j?.data?.[0]?.id;

      if (!condominioId) throw new Error("Condomínio salvo, mas não veio o ID na resposta da API (/api/condominios).");

      // 2) salva máquinas do condomínio
      const maquinasPayload = maquinas
        .map((m) => {
          const quantidadeRaw = Number(m.quantidade);
          const quantidade = Number.isFinite(quantidadeRaw) && quantidadeRaw > 0 ? Math.trunc(quantidadeRaw) : 0;

          return {
            categoria: m.categoria,
            capacidade_kg: m.capacidade_kg !== null ? Number(m.capacidade_kg) : null,
            quantidade, // 🔒 GARANTIDO
            valor_ciclo: Number(parseMoneyPtBr(m.valor_ciclo_text) || 0),
            limpeza_quimica_ciclos: clampPosInt(Number(m.limpeza_quimica_ciclos), 500),
            limpeza_mecanica_ciclos: clampPosInt(Number(m.limpeza_mecanica_ciclos), 2000),
          };
        })
        .filter((x) => Number(x.quantidade) > 0);

      if (!maquinasPayload.length) throw new Error("Informe quantidade de máquinas (mínimo 1).");

      // ✅ FIX DEFINITIVO: endpoint espera { itens: [...] }, não array puro
      const r2 = await fetch(`/api/condominios/${condominioId}/maquinas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: maquinasPayload }),
      });

      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(j2?.error || "Condomínio salvo, mas falhou ao salvar máquinas.");

      resetForm();
      setShowForm(false);

      setOk("Condomínio + máquinas salvos ✅");
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Cadastro do ponto">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{condos.length} condomínios</div>

        <div className="row" style={{ gap: 8 }}>
          {canEdit && (
            <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
              + Novo condomínio
            </button>
          )}
          <button className="btn" onClick={loadAll}>
            Recarregar
          </button>
        </div>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {ok && <p style={{ color: "#027a48" }}>{ok}</p>}

      {canEdit && showForm && (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8 }}>
            Novo condomínio
          </div>

          <div className="grid2">
            <div>
              <div className="small">Nome</div>
              <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>

            <div className="row">
              <div style={{ flex: 2 }}>
                <div className="small">Cidade</div>
                <input className="input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
              </div>
              <div style={{ width: 90 }}>
                <div className="small">UF</div>
                <input className="input" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
              </div>
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div className="grid2">
            <div>
              <div className="small">Tipo de pagamento</div>
              <select className="input" value={form.tipo_pagamento} onChange={(e) => setForm({ ...form, tipo_pagamento: e.target.value })}>
                <option value="direto">Direto (PIX/depósito)</option>
                <option value="boleto">Boleto</option>
              </select>
            </div>
            <div />
          </div>

          <div style={{ height: 10 }} />

          <div className="small">Endereço</div>
          <div className="grid2">
            <div>
              <div className="small">CEP</div>
              <input className="input" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
            </div>
            <div>
              <div className="small">Rua</div>
              <input className="input" value={form.rua} onChange={(e) => setForm({ ...form, rua: e.target.value })} />
            </div>
            <div>
              <div className="small">Número</div>
              <input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
            </div>
            <div>
              <div className="small">Bairro</div>
              <input className="input" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
            </div>
            <div>
              <div className="small">Complemento</div>
              <input className="input" value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value })} />
            </div>
            <div>
              <div className="small">Mapa</div>
              {mapsUrl ? (
                <a className="btn" href={mapsUrl} target="_blank">
                  Abrir no Google Maps
                </a>
              ) : (
                <div className="small">Preencha endereço</div>
              )}
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div className="small">Contatos</div>
          <div className="grid2">
            <div>
              <div className="small">Síndico (nome)</div>
              <input className="input" value={form.sindico_nome} onChange={(e) => setForm({ ...form, sindico_nome: e.target.value })} />
            </div>
            <div>
              <div className="small">Síndico (telefone)</div>
              <input className="input" value={form.sindico_telefone} onChange={(e) => setForm({ ...form, sindico_telefone: e.target.value })} />
            </div>
            <div>
              <div className="small">Zelador (nome)</div>
              <input className="input" value={form.zelador_nome} onChange={(e) => setForm({ ...form, zelador_nome: e.target.value })} />
            </div>
            <div>
              <div className="small">Zelador (telefone)</div>
              <input className="input" value={form.zelador_telefone} onChange={(e) => setForm({ ...form, zelador_telefone: e.target.value })} />
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div className="small">Financeiro</div>
          <div className="grid2">
            <div>
              <div className="small">Valor ciclo lavadora (R$)</div>
              <input
                className="input"
                placeholder="ex: 16,50"
                value={form.valor_ciclo_lavadora}
                onChange={(e) => setForm({ ...form, valor_ciclo_lavadora: e.target.value })}
              />
            </div>
            <div>
              <div className="small">Valor ciclo secadora (R$)</div>
              <input
                className="input"
                placeholder="ex: 8,00"
                value={form.valor_ciclo_secadora}
                onChange={(e) => setForm({ ...form, valor_ciclo_secadora: e.target.value })}
              />
            </div>
            <div>
              <div className="small">Cashback %</div>
              <input className="input" value={form.cashback_percent} onChange={(e) => setForm({ ...form, cashback_percent: e.target.value })} />
            </div>

            {/* ✅ NOVO: tarifas */}
            <div>
              <div className="small">Água (R$/m³)</div>
              <input className="input" placeholder="ex: 15,00" value={form.agua_valor_m3} onChange={(e) => setForm({ ...form, agua_valor_m3: e.target.value })} />
            </div>
            <div>
              <div className="small">Energia (R$/kWh)</div>
              <input
                className="input"
                placeholder="ex: 1,20"
                value={form.energia_valor_kwh}
                onChange={(e) => setForm({ ...form, energia_valor_kwh: e.target.value })}
              />
            </div>
            <div>
              <div className="small">Gás (R$/m³)</div>
              <input className="input" placeholder="ex: 30,00" value={form.gas_valor_m3} onChange={(e) => setForm({ ...form, gas_valor_m3: e.target.value })} />
            </div>
          </div>

          <div style={{ height: 14 }} />
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Parque de máquinas
            </div>
            <button className="btn" onClick={addMaquina}>
              + Adicionar tipo
            </button>
          </div>

          <div className="card" style={{ marginTop: 10 }}>
            <div className="small" style={{ marginBottom: 8 }}>
              Total máquinas: <b>{maquinasResumo.total}</b> &nbsp;|&nbsp; Lavadoras: <b>{maquinasResumo.lav}</b> &nbsp;|&nbsp; Secadoras: <b>{maquinasResumo.sec}</b>
            </div>

            {maquinas.length === 0 ? (
              <div className="small">Nenhuma máquina cadastrada.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {maquinas.map((m, i) => (
                  <div key={i} className="card" style={{ background: "#fff" }}>
                    <div className="grid2" style={{ alignItems: "end" }}>
                      <div>
                        <div className="small">Categoria</div>
                        <select className="input" value={m.categoria} onChange={(e) => updateMaquina(i, { categoria: e.target.value as any })}>
                          <option value="lavadora">Lavadora</option>
                          <option value="secadora">Secadora</option>
                        </select>
                      </div>

                      <div className="row">
                        <div style={{ flex: 1 }}>
                          <div className="small">Capacidade (kg)</div>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={m.capacidade_kg === null ? "" : String(m.capacidade_kg)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d.]/g, "");
                              updateMaquina(i, { capacidade_kg: raw === "" ? null : Number(raw) });
                            }}
                          />
                        </div>
                        <div style={{ width: 120 }}>
                          <div className="small">Qtd</div>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={String(m.quantidade ?? 1)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              updateMaquina(i, { quantidade: raw === "" ? 1 : Number(raw) });
                            }}
                            onBlur={() => {
                              const n = Number(m.quantidade);
                              if (!Number.isFinite(n) || n <= 0) updateMaquina(i, { quantidade: 1 });
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="small">Valor por ciclo</div>
                        <input
                          className="input"
                          inputMode="decimal"
                          placeholder="ex: 16,50"
                          value={m.valor_ciclo_text}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^\d.,]/g, "");
                            updateMaquina(i, { valor_ciclo_text: raw });
                          }}
                          onBlur={() => {
                            const n = parseMoneyPtBr(m.valor_ciclo_text);
                            updateMaquina(i, { valor_ciclo_text: formatMoneyPtBr(n) });
                          }}
                        />
                        <div className="small" style={{ opacity: 0.7, marginTop: 4 }}>
                          {brl(parseMoneyPtBr(m.valor_ciclo_text))}
                        </div>
                      </div>

                      <div className="row">
                        <div style={{ flex: 1 }}>
                          <div className="small">Limpeza química (ciclos)</div>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={String(m.limpeza_quimica_ciclos ?? 500)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              updateMaquina(i, { limpeza_quimica_ciclos: raw === "" ? 500 : Number(raw) });
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="small">Limpeza mecânica (ciclos)</div>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={String(m.limpeza_mecanica_ciclos ?? 2000)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              updateMaquina(i, { limpeza_mecanica_ciclos: raw === "" ? 2000 : Number(raw) });
                            }}
                          />
                        </div>
                      </div>

                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn" onClick={() => removeMaquina(i)}>
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ height: 10 }} />

          <div className="small">Dados bancários</div>
          <div className="grid2">
            <div>
              <div className="small">Banco</div>
              <input className="input" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
            </div>
            <div>
              <div className="small">Agência</div>
              <input className="input" value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} />
            </div>
            <div>
              <div className="small">Conta</div>
              <input className="input" value={form.conta} onChange={(e) => setForm({ ...form, conta: e.target.value })} />
            </div>
            <div>
              <div className="small">Tipo conta</div>
              <input className="input" value={form.tipo_conta} onChange={(e) => setForm({ ...form, tipo_conta: e.target.value })} />
            </div>
            <div>
              <div className="small">PIX</div>
              <input className="input" value={form.pix} onChange={(e) => setForm({ ...form, pix: e.target.value })} />
            </div>
            <div>
              <div className="small">Favorecido/CNPJ</div>
              <input className="input" value={form.favorecido_cnpj} onChange={(e) => setForm({ ...form, favorecido_cnpj: e.target.value })} />
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              Cancelar
            </button>

            <button className="btn primary" onClick={criar} disabled={saving || !form.nome || !form.cidade || !form.uf}>
              {saving ? "Salvando..." : "Salvar (Condomínio + Máquinas)"}
            </button>
          </div>
        </div>
      )}

      <hr className="hr" />

      <div className="list">
        {condos.map((c) => (
          <div key={c.id} className="card">
            <div style={{ fontWeight: 700 }}>
              {c.nome}
              {badgePagamento(c.tipo_pagamento)}
            </div>
            <div className="small">
              {c.cidade}/{c.uf}
            </div>
            <div className="small">{[c.rua, c.numero, c.bairro].filter(Boolean).join(", ")}</div>

            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              {canEdit && (
                <a className="btn primary" href={`/condominios/${c.id}`}>
                  Editar ponto
                </a>
              )}
              <a className="btn" href={`/condominios/${c.id}/maquinas`}>
                Ver máquinas
              </a>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
