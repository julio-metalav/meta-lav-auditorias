"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

export default function DashboardPage() {
  const [counts, setCounts] = useState<{ condominios: number; auditorias: number }>({ condominios: 0, auditorias: 0 });
  const [err, setErr] = useState<string | null>(null);

  async function loadCounts() {
    setErr(null);
    try {
      const [c, a] = await Promise.all([
        fetch("/api/condominios").then((r) => r.json()),
        fetch("/api/auditorias").then((r) => r.json()),
      ]);
      if (c?.error) throw new Error(c.error);
      if (a?.error) throw new Error(a.error);
      setCounts({ condominios: c?.data?.length ?? 0, auditorias: a?.data?.length ?? 0 });
    } catch (e: any) {
      setErr(e?.message || "Erro ao carregar");
    }
  }

  useEffect(() => {
    loadCounts();
  }, []);

  return (
    <AppShell title="Dashboard Gerencial">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">
          Base: <span className="badge">{counts.condominios} condomínios</span> <span className="badge">{counts.auditorias} auditorias</span>
        </div>
        <button className="btn" onClick={loadCounts}>Recarregar</button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      <div style={{ height: 12 }} />

      <div className="grid2">
        <div className="card" style={{ background: "#fbfcff" }}>
          <div className="small">Indicadores (MVP)</div>
          <ul className="small">
            <li>Receita Bruta (ciclos): em breve</li>
            <li>Cashback/Repasse: em breve</li>
            <li>Custos variáveis (água/energia/gás/químicos): em breve</li>
            <li>Margem de contribuição: em breve</li>
          </ul>
        </div>

        <div className="card" style={{ background: "#fbfcff" }}>
          <div className="small">Ranking (MVP)</div>
          <div className="small">Assim que tiver ciclos por máquina + preços por ciclo, eu monto o ranking melhores/piores.</div>
        </div>
      </div>

      <p className="small" style={{ marginTop: 14 }}>
        Próximo passo natural: interno fecha a auditoria com ciclos por máquina + comprovante de cashback; sistema gera PDF e (opcional) envia por email.
      </p>
    </AppShell>
  );
}
