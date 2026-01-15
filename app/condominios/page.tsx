"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
};

type Me = { user: { id: string; email: string }; role: string };

type MaquinaRow = {
  categoria: "lavadora" | "secadora";
  capacidade_kg: number | null;
  quantidade: number;
  valor_ciclo_text: string;
  limpeza_quimica_ciclos: number;
  limpeza_mecanica_ciclos: number;
};

function parseMoneyPtBr(input: string): number {
  const s = String(input ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/^R\$/i, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyPtBr(n: number): string {
  return Number(n ?? 0).toFixed(2).replace(".", ",");
}

export default function CondominiosPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formRef = useRef<HTMLDivElement | null>(null);
  const canEdit = me?.role === "interno" || me?.role === "gestor";

  const [form, setForm] = useState<any>({
    nome: "",
    cidade: "",
    uf: "",
  });

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

  async function loadAll() {
    const [m, c] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/condominios").then((r) => r.json()),
    ]);
    setMe(m);
    setCondos(c.data || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function criar() {
    setErr(null);
    setOk(null);
    setSaving(true);

    try {
      if (!form.nome || !form.cidade || !form.uf) {
        throw new Error("Preencha Nome, Cidade e UF.");
      }

      // 1) cria condomínio
      const r = await fetch("/api/condominios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erro ao salvar condomínio");

      const condominioId = j?.data?.id;
      if (!condominioId) throw new Error("ID do condomínio não retornado.");

      // 2) gera maquinas COM maquina_tag
      const maquinasPayload: any[] = [];
      let lavCount = 1;
      let secCount = 1;

      for (const m of maquinas) {
        for (let i = 0; i < m.quantidade; i++) {
          const tag =
            m.categoria === "lavadora"
              ? `LAV-${String(lavCount++).padStart(2, "0")}`
              : `SEC-${String(secCount++).padStart(2, "0")}`;

          maquinasPayload.push({
            maquina_tag: tag,
            categoria: m.categoria,
            capacidade_kg: m.capacidade_kg,
            valor_ciclo: parseMoneyPtBr(m.valor_ciclo_text),
            limpeza_quimica_ciclos: m.limpeza_quimica_ciclos,
            limpeza_mecanica_ciclos: m.limpeza_mecanica_ciclos,
          });
        }
      }

      const r2 = await fetch(`/api/condominios/${condominioId}/maquinas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maquinasPayload),
      });

      const j2 = await r2.json();
      if (!r2.ok) throw new Error(j2?.error || "Erro ao salvar máquinas");

      setOk("Condomínio e máquinas salvos com sucesso.");
      setForm({ nome: "", cidade: "", uf: "" });
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

      await loadAll();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Cadastro do ponto">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>{condos.length} condomínios</div>
        {canEdit && (
          <button className="btn dark" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth" })}>
            + Novo condomínio
          </button>
        )}
      </div>

      {err && <p style={{ color: "red" }}>{err}</p>}
      {ok && <p style={{ color: "green" }}>{ok}</p>}

      {canEdit && (
        <div ref={formRef} className="card" style={{ marginTop: 16 }}>
          <input
            className="input"
            placeholder="Nome"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
          <input
            className="input"
            placeholder="Cidade"
            value={form.cidade}
            onChange={(e) => setForm({ ...form, cidade: e.target.value })}
          />
          <input
            className="input"
            placeholder="UF"
            value={form.uf}
            onChange={(e) => setForm({ ...form, uf: e.target.value })}
          />

          <button className="btn primary" onClick={criar} disabled={saving}>
            {saving ? "Salvando..." : "Salvar condomínio"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
