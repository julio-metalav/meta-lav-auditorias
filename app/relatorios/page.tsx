"use client";

import { AppShell } from "@/app/components/AppShell";

export default function RelatoriosPage() {
  return (
    <AppShell title="Relatórios / PDF">
      <div className="card" style={{ background: "#fbfcff" }}>
        <div className="small">Aqui entra:</div>
        <ul className="small">
          <li>Filtro por período, cidade e condomínio</li>
          <li>KPI: Receita, cashback, custos variáveis, margem de contribuição, EBITDA (Earnings Before Interest, Taxes, Depreciation and Amortization)</li>
          <li>Ranking melhores/piores</li>
          <li>Gerar PDF da auditoria (com anexos) para enviar ao síndico/admin</li>
        </ul>
        <p className="small">
          Eu deixei esta tela como placeholder porque o próximo passo depende de você decidir 1) formato do PDF e 2) se o envio será via SMTP (ex: SendGrid) ou manual.
        </p>
      </div>
    </AppShell>
  );
}
