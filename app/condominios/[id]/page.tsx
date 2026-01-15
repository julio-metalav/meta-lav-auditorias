"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type TipoPagamento = "direto" | "boleto";

type Condo = {
  id: string;
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

  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  tipo_conta?: string | null;
  pix?: string | null;
  favorecido_cnpj?: string | null;

  tipo_pagamento?: TipoPagamento | null;
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

function normalizeTipoPagamento(v: any): TipoPagamento {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "boleto" ? "boleto" : "direto";
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
    banco: "",
    agencia: "",
    conta: "",
    tipo_conta: "",
    pix: "",
    favorecido_cnpj: "",
    tipo_pagamento: "direto" as TipoPagamento,
  });

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  const mapsUrl = useMemo(() => {
    const parts = [form.rua, form.numero, form.bairro, form.cidade, form.uf, form.cep]
      .map((x: string) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");
    return parts ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}` : "";
  }, [form]);

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

        valor_ciclo_lavadora: condo.valor_ciclo_lavadora === null || condo.valor_ciclo_lavadora === undefined ? "" : formatMoneyPtBr(Number(condo.valor_ciclo_lavadora)),
        valor_ciclo_secadora: condo.valor_ciclo_secadora === null || condo.valor_ciclo_secadora === undefined ? "" : formatMoneyPtBr(Number(condo.valor_ciclo_secadora)),

        cashback_percent: condo.cashback_percent === null || condo.cashback_percent === undefined ? "" : String(condo.cashback_percent),

        banco: condo.banco ?? "",
        agencia: condo.agencia ?? "",
        conta: condo.conta ?? "",
        tipo_conta: condo.tipo_conta ?? "",
        pix: condo.pix ?? "",
        favorecido_cnpj: condo.favorecido_cnpj ?? "",

        tipo_pagamento: normalizeTipoPagamento(condo.tipo_pagamento),
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
      if (!form.nome || !form.cidade || !form.uf) throw new Error("Preencha Nome, Cidade e UF.");

      const payload: any = { ...form };
      payload.tipo_pagamento = normalizeTipoPagamento(form.tipo_pagamento);

      // money
      payload.valor_ciclo_lavadora = payload.valor_ciclo_lavadora ? parseMoneyPtBr(String(payload.valor_ciclo_lavadora)) : null;
      payload.valor_ciclo_secadora = payload.valor_ciclo_secadora ? parseMoneyPtBr(String(payload.valor_ciclo_secadora)) : null;

      // percent
      payload.cashback_percent = payload.cashback_percent ? Number(payload.cashback_percent) : null;

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
          <a className="btn" href="/condominios">← Voltar</a>
          <a className="btn" href={`/condominios/${id}/maquinas`}>Ver máquinas</a>
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
          <div className="small" style={{ marginBottom: 8 }}>Dados do condomínio</div>

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
              {mapsUrl ? <a className="btn" href={mapsUrl} target="_blank">Abrir no Google Maps</a> : <div className="small">Preencha endereço</div>}
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
          <div className="small">Dados bancários</div>
          <div className="grid2">
            <div><div className="small">Banco</div><input className="input" value={form.banco} onChange={(e)=>setForm({...form,banco:e.target.value})}/></div>
            <div><div className="small">Agência</div><input className="input" value={form.agencia} onChange={(e)=>setForm({...form,agencia:e.target.value})}/></div>
            <div><div className="small">Conta</div><input className="input" value={form.conta} onChange={(e)=>setForm({...form,conta:e.target.value})}/></div>
            <div><div className="small">Tipo conta</div><input className="input" value={form.tipo_conta} onChange={(e)=>setForm({...form,tipo_conta:e.target.value})}/></div>
            <div><div className="small">PIX</div><input className="input" value={form.pix} onChange={(e)=>setForm({...form,pix:e.target.value})}/></div>
            <div><div className="small">Favorecido/CNPJ</div><input className="input" value={form.favorecido_cnpj} onChange={(e)=>setForm({...form,favorecido_cnpj:e.target.value})}/></div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn primary" onClick={salvar} disabled={!canEdit || saving || !form.nome || !form.cidade || !form.uf}>
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
