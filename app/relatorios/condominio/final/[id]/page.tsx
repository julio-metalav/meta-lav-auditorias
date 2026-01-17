"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type ReportDTO = {
  meta: {
    auditoria_id: string;
    condominio_nome: string;
    competencia: string;
    gerado_em: string;
  };
  vendas_por_maquina: {
    itens: Array<{
      maquina: string;
      tipo: string;
      ciclos: number;
      valor_unitario: number;
      receita: number;
    }>;
    receita_bruta_total: number;
    cashback_percent: number;
    valor_cashback: number;
  };
  consumo_insumos: {
    itens: Array<{
      insumo: string;
      leitura_anterior: number | null;
      leitura_atual: number | null;
      consumo: number;
      valor_total: number;
    }>;
    total_repasse_consumo: number;
  };
  totalizacao_final: {
    cashback: number;
    repasse_consumo: number;
    total_a_pagar_condominio: number;
  };
  observacoes: string | null;
  anexos: {
    foto_agua_url?: string | null;
    foto_energia_url?: string | null;
    foto_gas_url?: string | null;
    comprovante_fechamento_url?: string | null;
  };
};

function brl(v: any) {
  const n = Number(v);
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtLeitura(v: number | null) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}

function Box({ children }: { children: any }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="p-6">{children}</div>
    </div>
  );
}

function SectionTitle({ n, title, subtitle }: { n: string; title: string; subtitle?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <div className="text-sm font-semibold text-zinc-500">{n}</div>
        <h2 className="text-xl font-semibold text-zinc-900">{title}</h2>
      </div>
      {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
    </div>
  );
}

function Table({ children }: { children: any }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export default function RelatorioFinalPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ReportDTO | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/relatorios/condominio/final/${id}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Falha ao carregar relatório.");
        if (alive) setData(json?.data ?? null);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "Erro inesperado");
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (id) run();
    return () => {
      alive = false;
    };
  }, [id]);

  const anexos = useMemo(() => {
    const a = data?.anexos ?? {};
    const items: Array<{ label: string; url?: string | null }> = [
      { label: "Foto do medidor de Água", url: a.foto_agua_url },
      { label: "Foto do medidor de Energia", url: a.foto_energia_url },
      { label: "Foto do medidor de Gás", url: a.foto_gas_url },
      { label: "Comprovante de pagamento", url: a.comprovante_fechamento_url },
    ];
    return items.filter((x) => x.url);
  }, [data]);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <div className="text-sm text-zinc-500">Relatório final</div>

          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">
                Prestação de Contas — Lavanderia Compartilhada
              </h1>
              <p className="mt-1 text-sm text-zinc-500">Visualização para conferência.</p>
            </div>

            {/* ✅ Botão PDF (dentro do componente, com id válido) */}
            <a
              href={`/api/relatorios/condominio/final/${id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2 text-sm text-white"
            >
              Baixar PDF
            </a>
          </div>
        </div>

        {loading ? (
          <Box>
            <div className="text-sm text-zinc-600">Carregando…</div>
          </Box>
        ) : err ? (
          <Box>
            <div className="text-sm text-red-600">{err}</div>
          </Box>
        ) : !data ? (
          <Box>
            <div className="text-sm text-zinc-600">Sem dados.</div>
          </Box>
        ) : (
          <div className="space-y-6">
            {/* CAPA */}
            <Box>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-500">META LAV</div>
                  <div className="mt-2 text-2xl font-semibold text-zinc-900">{data.meta.condominio_nome}</div>
                  <div className="mt-1 text-sm text-zinc-500">Competência: {data.meta.competencia}</div>
                </div>
                <div className="sm:text-right">
                  <div className="text-xs text-zinc-500">Gerado em</div>
                  <div className="text-sm text-zinc-700">
                    {new Date(data.meta.gerado_em).toLocaleString("pt-BR")}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-zinc-50 p-4">
                <div className="text-sm font-medium text-zinc-800">
                  Relatório de Prestação de Contas – Lavanderia Compartilhada
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Auditoria finalizada. Valores abaixo consolidam vendas, cashback e repasse de consumo.
                </div>
              </div>
            </Box>

            {/* 1 VENDAS */}
            <Box>
              <SectionTitle n="1" title="Vendas por máquina" subtitle="Fechamento de caixa por tipo/capacidade" />

              <Table>
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Máquina</th>
                    <th className="px-4 py-3 text-left font-medium">Tipo</th>
                    <th className="px-4 py-3 text-right font-medium">Ciclos</th>
                    <th className="px-4 py-3 text-right font-medium">Valor unitário</th>
                    <th className="px-4 py-3 text-right font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vendas_por_maquina.itens.map((it, idx) => (
                    <tr key={idx} className="border-t border-zinc-200">
                      <td className="px-4 py-3 text-zinc-900">{it.maquina}</td>
                      <td className="px-4 py-3 text-zinc-700">{it.tipo}</td>
                      <td className="px-4 py-3 text-right text-zinc-700">{it.ciclos}</td>
                      <td className="px-4 py-3 text-right text-zinc-700">{brl(it.valor_unitario)}</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900">{brl(it.receita)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">Receita Bruta Total</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900">
                    {brl(data.vendas_por_maquina.receita_bruta_total)}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">Cashback</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900">
                    {data.vendas_por_maquina.cashback_percent}%
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">Valor do Cashback</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900">
                    {brl(data.vendas_por_maquina.valor_cashback)}
                  </div>
                </div>
              </div>
            </Box>

            {/* 2 CONSUMO */}
            <Box>
              <SectionTitle n="2" title="Consumo de insumos" subtitle="Leitura anterior, leitura atual, consumo e repasse" />

              <Table>
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Insumo</th>
                    <th className="px-4 py-3 text-right font-medium">Leitura anterior</th>
                    <th className="px-4 py-3 text-right font-medium">Leitura atual</th>
                    <th className="px-4 py-3 text-right font-medium">Consumo</th>
                    <th className="px-4 py-3 text-right font-medium">Valor (repasse)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consumo_insumos.itens.map((it, idx) => (
                    <tr key={idx} className="border-t border-zinc-200">
                      <td className="px-4 py-3 text-zinc-900">{it.insumo}</td>
                      <td className="px-4 py-3 text-right text-zinc-700">{fmtLeitura(it.leitura_anterior)}</td>
                      <td className="px-4 py-3 text-right text-zinc-700">{fmtLeitura(it.leitura_atual)}</td>
                      <td className="px-4 py-3 text-right text-zinc-700">{it.consumo}</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900">{brl(it.valor_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="mt-5 rounded-xl bg-zinc-50 p-4">
                <div className="text-xs text-zinc-500">Total do Repasse de Consumo</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {brl(data.consumo_insumos.total_repasse_consumo)}
                </div>
              </div>
            </Box>

            {/* 3 TOTAL */}
            <Box>
              <SectionTitle n="3" title="Totalização final" subtitle="Este é o número principal do relatório" />

              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-zinc-200">
                      <td className="px-4 py-3 text-zinc-700">Cashback</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900">
                        {brl(data.totalizacao_final.cashback)}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-200">
                      <td className="px-4 py-3 text-zinc-700">Repasse de consumo</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900">
                        {brl(data.totalizacao_final.repasse_consumo)}
                      </td>
                    </tr>
                    <tr className="bg-zinc-50">
                      <td className="px-4 py-4 font-semibold text-zinc-900">TOTAL A PAGAR AO CONDOMÍNIO</td>
                      <td className="px-4 py-4 text-right text-lg font-semibold text-zinc-900">
                        {brl(data.totalizacao_final.total_a_pagar_condominio)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Box>

            {/* 4 OBS */}
            <Box>
              <SectionTitle n="4" title="Observações" />
              <div className="mt-3 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">
                {data.observacoes?.trim() ? data.observacoes : "—"}
              </div>
            </Box>

            {/* 5 ANEXOS */}
            <Box>
              <SectionTitle n="5" title="Anexos" subtitle="Links para conferência (o PDF embute as fotos de medidores)" />

              {anexos.length === 0 ? (
                <div className="mt-3 text-sm text-zinc-600">Nenhum anexo disponível.</div>
              ) : (
                <div className="mt-4 grid gap-3">
                  {anexos.map((a, idx) => (
                    <a
                      key={idx}
                      href={a.url!}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:bg-zinc-50"
                    >
                      <div className="text-sm font-medium text-zinc-900">{a.label}</div>
                      <div className="text-xs text-zinc-500">Abrir</div>
                    </a>
                  ))}
                </div>
              )}
            </Box>
          </div>
        )}
      </div>
    </AppShell>
  );
}
