"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type TipoPagamento = "direto" | "boleto";

type Condo = {
  id: string;

  // ✅ NOVO
  codigo_condominio?: string | null;

  nome: string;
  cidade: string;
  uf: string;
  cep?: string | null;
  rua?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;

  sindico_nome?: string | null;
  sindico_telefone?: string | null;
  zelador_nome?: string | null;
  zelador_telefone?: string | null;

  valor_ciclo_lavadora?: number | null;
  valor_ciclo_secadora?: number | null;
  cashback_percent?: number | null;

  // ✅ NOVO: custos operacionais / pagamentos
  custo_quimicos_por_ciclo_lavadora?: number | null; // R$/ciclo (lavadora)
  stone_taxa_percent?: number | null; // % (ex: 2.36)
  stone_taxa_fixa_por_transacao?: number | null; // R$ por transação
  custo_sistema_pagamento_mensal?: number | null; // R$/mês

  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  tipo_conta?: string | null;
  pix?: string | null;
  favorecido_cnpj?: string | null;

  tipo_pagamento?: TipoPagamento | null;

  // ✅ contrato + emails
  contrato_assinado_em?: string | null; // YYYY-MM-DD
  contrato_prazo_meses?: number | null;
  contrato_vencimento_em?: string | null; // YYYY-MM-DD
  email_sindico?: string | null;
  email_financeiro?: string | null;
};

type Me = { user: { id: string; email: string }; role: string };

function parseMoneyPtBr(input: string): number {
  const s = String(input ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/^R\$/i, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyPtBr(n: number): string {
  const fixed = Number(n ?? 0).toFixed(2);
  return fixed.replace(".", ",");
}

function parsePercentPtBr(input: string): number {
  const s = String(input ?? "").trim();
  if (!s) return 0;
  const normalized = s.replace(/\s/g, "").replace("%", "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
}

function cleanEmail(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function cleanDateYYYYMMDD(v: any): string {
  const s = String(v ?? "").trim();
  return s;
}

function cleanIntText(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const only = s.replace(/[^\d]/g, "");
  return only;
}

function onlyDigits(v: any) {
  return String(v ?? "").replace(/[^\d]/g, "");
}

function calcVencimento(assinadoEm: string, prazoMesesText: string): string {
  const a = String(assinadoEm ?? "").trim();
  const ptxt = String(prazoMesesText ?? "").trim();
  if (!a || !ptxt) return "";

  const prazo = Number(ptxt);
  if (!Number.isFinite(prazo) || prazo <= 0) return "";

  const d = new Date(a + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";

  d.setMonth(d.getMonth() + Math.trunc(prazo));
  return d.toISOString().slice(0, 10);
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Erro");
  return json;
}

export default function CondominioEditPage({ params }: { params: { id: string } }) {
  const id = String(params?.id ?? "").trim();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<any>({
    // ✅ NOVO
    codigo_condominio: "",

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

    // ✅ NOVO: custos / pagamentos
    custo_quimicos_por_ciclo_lavadora: "",
    stone_taxa_percent: "",
    stone_taxa_fixa_por_transacao: "",
    custo_sistema_pagamento_mensal: "",

    banco: "",
    agencia: "",
    conta: "",
    tipo_conta: "",
    pix: "",
    favorecido_cnpj: "",
    tipo_pagamento: "direto" as TipoPagamento,

    // contrato + emails
    contrato_assinado_em: "",
    contrato_prazo_meses: "",
    contrato_vencimento_em: "",
    email_sindico: "",
    email_financeiro: "",
  });

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  const mapsUrl = useMemo(() => {
    const parts = [form.rua, form.numero, form.bairro, form.cidade, form.uf, form.cep]
      .map((x: string) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");
    return parts ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}` : "";
  }, [form]);

  const codigoLocked = useMemo(() => {
    // trava edição se já veio preenchido do backend
    return String(form.codigo_condominio ?? "").trim().length === 4;
  }, [form.codigo_condominio]);

  const codigoOk = useMemo(() => {
    const c = String(form.codigo_condominio ?? "").trim();
    return c === "" || /^\d{4}$/.test(c);
  }, [form.codigo_condominio]);

  async function loadAll() {
    setErr(null);
    setOk(null);
    setLoading(true);

    try {
      const [m, c] = await Promise.all([fetchJSON("/api/me"), fetchJSON(`/api/condominios/${id}`)]);

      setMe(m);

      const condo: Condo = c?.data ?? c;
      if (!condo?.id) throw new Error("Condomínio não encontrado.");

      setForm({
        codigo_condominio: condo.codigo_condominio ?? "",

        nome: condo.nome ?? "",
        cidade: condo.cidade ?? "",
        uf: condo.uf ?? "",
        cep: condo.cep ?? "",
        rua: condo.rua ?? "",
        numero: condo.numero ?? "",
        bairro: condo.bairro ?? "",
        complemento: condo.complemento ?? "",

        sindico_nome: condo.sindico_nome ?? "",
        sindico_telefone: condo.sindico_telefone ?? "",
        zelador_nome: condo.zelador_nome ?? "",
        zelador_telefone: condo.zelador_telefone ?? "",

        valor_ciclo_lavadora:
          condo.valor_ciclo_lavadora === null || condo.valor_ciclo_lavadora === undefined
            ? ""
            : formatMoneyPtBr(Number(condo.valor_ciclo_lavadora)),
        valor_ciclo_secadora:
          condo.valor_ciclo_secadora === null || condo.valor_ciclo_secadora === undefined
            ? ""
            : formatMoneyPtBr(Number(condo.valor_ciclo_secadora)),

        cashback_percent:
          condo.cashback_percent === null || condo.cashback_percent === undefined ? "" : String(condo.cashback_percent),

        // ✅ NOVO: custos / pagamentos
        custo_quimicos_por_ciclo_lavadora:
          condo.custo_quimicos_por_ciclo_lavadora === null || condo.custo_quimicos_por_ciclo_lavadora === undefined
            ? ""
            : formatMoneyPtBr(Number(condo.custo_quimicos_por_ciclo_lavadora)),

        stone_taxa_percent:
          condo.stone_taxa_percent === null || condo.stone_taxa_percent === undefined
            ? ""
            : String(condo.stone_taxa_percent).replace(".", ","),

        stone_taxa_fixa_por_transacao:
          condo.stone_taxa_fixa_por_transacao === null || condo.stone_taxa_fixa_por_transacao === undefined
            ? ""
            : formatMoneyPtBr(Number(condo.stone_taxa_fixa_por_transacao)),

        custo_sistema_pagamento_mensal:
          condo.custo_sistema_pagamento_mensal === null || condo.custo_sistema_pagamento_mensal === undefined
            ? ""
            : formatMoneyPtBr(Number(condo.custo_sistema_pagamento_mensal)),

        banco: condo.banco ?? "",
        agencia: condo.agencia ?? "",
        conta: condo.conta ?? "",
        tipo_conta: condo.tipo_conta ?? "",
        pix: condo.pix ?? "",
        favorecido_cnpj: condo.favorecido_cnpj ?? "",

        tipo_pagamento: normalizeTipoPagamento(condo.tipo_pagamento),

        contrato_assinado_em: condo.contrato_assinado_em ?? "",
        contrato_prazo_meses:
          condo.contrato_prazo_meses === null || condo.contrato_prazo_meses === undefined ? "" : String(condo.contrato_prazo_meses),
        contrato_vencimento_em: condo.contrato_vencimento_em ?? "",
        email_sindico: condo.email_sindico ?? "",
        email_financeiro: condo.email_financeiro ?? "",
      });
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function salvar() {
    setErr(null);
    setOk(null);
    setSaving(true);

    try {
      if (!canEdit) throw new Error("Sem permissão.");
      if (!form.nome) throw new Error("Preencha Nome.");

      // codigo: se preenchido, tem que ser 4 dígitos
      const codigo = String(form.codigo_condominio ?? "").trim();
      if (codigo && !/^\d{4}$/.test(codigo)) throw new Error("Código do condomínio inválido. Use 4 dígitos (ex: 0001).");

      const payload: any = { ...form };
      payload.tipo_pagamento = normalizeTipoPagamento(form.tipo_pagamento);

      // ✅ código: só dígitos e 4
      payload.codigo_condominio = codigo ? onlyDigits(codigo).slice(0, 4) : null;

      // money
      payload.valor_ciclo_lavadora = payload.valor_ciclo_lavadora ? parseMoneyPtBr(String(payload.valor_ciclo_lavadora)) : null;
      payload.valor_ciclo_secadora = payload.valor_ciclo_secadora ? parseMoneyPtBr(String(payload.valor_ciclo_secadora)) : null;

      // ✅ NOVO: money (químicos / stone fixa / sistema mensal)
      payload.custo_quimicos_por_ciclo_lavadora = payload.custo_quimicos_por_ciclo_lavadora
        ? parseMoneyPtBr(String(payload.custo_quimicos_por_ciclo_lavadora))
        : null;

      payload.stone_taxa_fixa_por_transacao = payload.stone_taxa_fixa_por_transacao
        ? parseMoneyPtBr(String(payload.stone_taxa_fixa_por_transacao))
        : null;

      payload.custo_sistema_pagamento_mensal = payload.custo_sistema_pagamento_mensal
        ? parseMoneyPtBr(String(payload.custo_sistema_pagamento_mensal))
        : null;

      // percent
      payload.cashback_percent = payload.cashback_percent ? Number(payload.cashback_percent) : null;

      // ✅ NOVO: percent stone (aceita "2,36")
      payload.stone_taxa_percent = payload.stone_taxa_percent ? parsePercentPtBr(String(payload.stone_taxa_percent)) : null;

      // contrato + emails
      payload.contrato_assinado_em = cleanDateYYYYMMDD(payload.contrato_assinado_em) || null;
      payload.contrato_prazo_meses = cleanIntText(payload.contrato_prazo_meses) ? Number(cleanIntText(payload.contrato_prazo_meses)) : null;
      payload.contrato_vencimento_em = cleanDateYYYYMMDD(payload.contrato_vencimento_em) || null;

      payload.email_sindico = cleanEmail(payload.email_sindico) || null;
      payload.email_financeiro = cleanEmail(payload.email_financeiro) || null;

      const r = await fetch(`/api/condominios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Erro ao salvar");

      setOk("Condomínio atualizado ✅");
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Editar condomínio">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <a className="btn" href="/condominios">
            ← Voltar
          </a>
          <a className="btn" href={`/condominios/${id}/maquinas`}>
            Ver máquinas
          </a>
        </div>
        <button className="btn" onClick={loadAll} disabled={loading}>
          Recarregar
        </button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {ok && <p style={{ color: "#027a48" }}>{ok}</p>}

      {loading ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="small">Carregando…</div>
        </div>
      ) : (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8 }}>
            Dados do condomínio
          </div>

          <div className="grid2">
            {/* ✅ NOVO: CÓDIGO */}
            <div>
              <div className="small">Código do condomínio</div>
              <input
                className="input"
                inputMode="numeric"
                placeholder="0001"
                value={form.codigo_condominio}
                onChange={(e) => {
                  const v = onlyDigits(e.target.value).slice(0, 4);
                  setForm({ ...form, codigo_condominio: v });
                }}
                disabled={codigoLocked} // trava se já tem código
              />
              {!codigoOk && (
                <div className="small" style={{ color: "#b42318", marginTop: 4 }}>
                  Use 4 dígitos (ex: 0001).
                </div>
              )}
              {codigoLocked && (
                <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                  Código já definido (travado para não bagunçar suas pastas).
                </div>
              )}
            </div>

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
          <div className="small">Pagamento do condomínio</div>
          <div className="grid2">
            <div>
              <div className="small">Tipo de pagamento</div>
              <select
                className="input"
                value={form.tipo_pagamento}
                onChange={(e) => setForm({ ...form, tipo_pagamento: normalizeTipoPagamento(e.target.value) })}
              >
                <option value="direto">Direto (PIX/depósito) — exige comprovante</option>
                <option value="boleto">Boleto — pode fechar sem comprovante</option>
              </select>
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Regra automática no fechamento da auditoria.
              </div>
            </div>

            <div>
              <div className="small">Mapa</div>
              {mapsUrl ? (
                <a className="btn" href={mapsUrl} target="_blank" rel="noreferrer">
                  Abrir no Google Maps
                </a>
              ) : (
                <div className="small">Preencha endereço</div>
              )}
            </div>
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

            <div>
              <div className="small">E-mail do síndico</div>
              <input className="input" placeholder="sindico@..." value={form.email_sindico} onChange={(e) => setForm({ ...form, email_sindico: e.target.value })} />
            </div>
            <div>
              <div className="small">E-mail do financeiro</div>
              <input className="input" placeholder="financeiro@..." value={form.email_financeiro} onChange={(e) => setForm({ ...form, email_financeiro: e.target.value })} />
            </div>
          </div>

          <div style={{ height: 10 }} />
          <div className="small">Contrato</div>
          <div className="grid2">
            <div>
              <div className="small">Data de assinatura</div>
              <input
                className="input"
                type="date"
                value={form.contrato_assinado_em}
                onChange={(e) => {
                  const v = cleanDateYYYYMMDD(e.target.value);
                  const prazoTxt = String(form.contrato_prazo_meses ?? "");
                  const venc = calcVencimento(v, prazoTxt);
                  setForm({ ...form, contrato_assinado_em: v, contrato_vencimento_em: venc || form.contrato_vencimento_em });
                }}
              />
            </div>

            <div>
              <div className="small">Prazo (meses)</div>
              <input
                className="input"
                inputMode="numeric"
                placeholder="ex: 36"
                value={form.contrato_prazo_meses}
                onChange={(e) => {
                  const prazoTxt = cleanIntText(e.target.value);
                  const venc = calcVencimento(String(form.contrato_assinado_em ?? ""), prazoTxt);
                  setForm({ ...form, contrato_prazo_meses: prazoTxt, contrato_vencimento_em: venc || form.contrato_vencimento_em });
                }}
              />
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Se preencher assinatura + prazo, o vencimento é calculado automaticamente.
              </div>
            </div>

            <div>
              <div className="small">Vencimento</div>
              <input className="input" type="date" value={form.contrato_vencimento_em} onChange={(e) => setForm({ ...form, contrato_vencimento_em: cleanDateYYYYMMDD(e.target.value) })} />
            </div>

            <div />
          </div>

          <div style={{ height: 10 }} />
          <div className="small">Financeiro</div>
          <div className="grid2">
            <div>
              <div className="small">Valor ciclo lavadora (R$)</div>
              <input className="input" placeholder="ex: 16,50" value={form.valor_ciclo_lavadora} onChange={(e) => setForm({ ...form, valor_ciclo_lavadora: e.target.value })} />
            </div>
            <div>
              <div className="small">Valor ciclo secadora (R$)</div>
              <input className="input" placeholder="ex: 8,00" value={form.valor_ciclo_secadora} onChange={(e) => setForm({ ...form, valor_ciclo_secadora: e.target.value })} />
            </div>
            <div>
              <div className="small">Cashback %</div>
              <input className="input" value={form.cashback_percent} onChange={(e) => setForm({ ...form, cashback_percent: e.target.value })} />
            </div>
          </div>

          <div style={{ height: 10 }} />
          <div className="small">Custos (insumos e pagamentos)</div>
          <div className="grid2">
            <div>
              <div className="small">Químicos lavadora (R$ por ciclo)</div>
              <input
                className="input"
                placeholder="ex: 2,00"
                value={form.custo_quimicos_por_ciclo_lavadora}
                onChange={(e) => setForm({ ...form, custo_quimicos_por_ciclo_lavadora: e.target.value })}
              />
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Aplica somente na <b>lavadora</b>.
              </div>
            </div>

            <div>
              <div className="small">Sistema de pagamento (R$ por mês)</div>
              <input
                className="input"
                placeholder="ex: 89,90"
                value={form.custo_sistema_pagamento_mensal}
                onChange={(e) => setForm({ ...form, custo_sistema_pagamento_mensal: e.target.value })}
              />
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Custo fixo mensal do condomínio.
              </div>
            </div>

            <div>
              <div className="small">Stone taxa % (sobre transação)</div>
              <input
                className="input"
                placeholder="ex: 2,36"
                value={form.stone_taxa_percent}
                onChange={(e) => setForm({ ...form, stone_taxa_percent: e.target.value })}
              />
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Ex.: 2,36 = 2,36%
              </div>
            </div>

            <div>
              <div className="small">Stone taxa fixa (R$ por transação)</div>
              <input
                className="input"
                placeholder="ex: 0,25"
                value={form.stone_taxa_fixa_por_transacao}
                onChange={(e) => setForm({ ...form, stone_taxa_fixa_por_transacao: e.target.value })}
              />
              <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
                Se não tiver, pode deixar 0.
              </div>
            </div>
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

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn primary" onClick={salvar} disabled={!canEdit || saving || !form.nome || !codigoOk}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>

          {!canEdit && (
            <div className="small" style={{ marginTop: 8, opacity: 0.7 }}>
              Você está como <b>{me?.role ?? "—"}</b>. Somente <b>interno/gestor</b> podem editar.
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
