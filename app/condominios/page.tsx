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
};

type Me = { user: { id: string; email: string }; role: string };

export default function CondominiosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [err, setErr] = useState<string | null>(null);
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
  });

  const canEdit = me?.role === "interno" || me?.role === "gestor";

  async function loadAll() {
    setErr(null);
    const [m, c] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
    ]);
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

  async function criar() {
    setErr(null);
    const payload = { ...form };
    // converter números
    payload.valor_ciclo_lavadora = payload.valor_ciclo_lavadora ? Number(payload.valor_ciclo_lavadora) : null;
    payload.valor_ciclo_secadora = payload.valor_ciclo_secadora ? Number(payload.valor_ciclo_secadora) : null;
    payload.cashback_percent = payload.cashback_percent ? Number(payload.cashback_percent) : null;

    const r = await fetch("/api/condominios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j?.error || "Erro ao salvar");
      return;
    }
    setForm({ nome: "", cidade: "", uf: "" });
    loadAll();
  }

  return (
    <AppShell title="Cadastro do ponto">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">{condos.length} condomínios</div>
        <button className="btn" onClick={loadAll}>Recarregar</button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      {canEdit && (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8 }}>Novo condomínio</div>

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
              {mapsUrl ? <a className="btn" href={mapsUrl} target="_blank">Abrir no Google Maps</a> : <div className="small">Preencha endereço</div>}
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
              <input className="input" value={form.valor_ciclo_lavadora} onChange={(e) => setForm({ ...form, valor_ciclo_lavadora: e.target.value })} />
            </div>
            <div>
              <div className="small">Valor ciclo secadora (R$)</div>
              <input className="input" value={form.valor_ciclo_secadora} onChange={(e) => setForm({ ...form, valor_ciclo_secadora: e.target.value })} />
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
            <button className="btn primary" onClick={criar} disabled={!form.nome || !form.cidade || !form.uf}>Salvar</button>
          </div>
        </div>
      )}

      <hr className="hr" />

      <div className="list">
        {condos.map((c) => (
          <div key={c.id} className="card">
            <div style={{ fontWeight: 700 }}>{c.nome}</div>
            <div className="small">{c.cidade}/{c.uf}</div>
            <div className="small">{[c.rua, c.numero, c.bairro].filter(Boolean).join(", ")}</div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
