"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import { useRouter } from "next/navigation";

type Role = "auditor" | "interno" | "gestor";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type Report = {
  mes_ref: string;
  counts: {
    total: number;
    aberta: number;
    em_andamento: number;
    em_conferencia: number;
    final: number;
    outros: number;
  };
  condominios_total: number;
  logs: any[];
  logs_error?: string | null;
};

function pct(a: number, b: number) {
  if (!b) return "0%";
  const v = (a / b) * 100;
  return `${v.toFixed(0)}%`;
}

export default function RelatoriosMesAtualPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSee = me?.role === "gestor" || me?.role === "interno";

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
      if (!meRes?.user) {
        router.push("/login?next=/admin/relatorios");
        return;
      }
      setMe(meRes);

      if (!(meRes.role === "gestor" || meRes.role === "interno")) {
        setErr("Sem permissão (apenas Interno/Gestor).");
        return;
      }

      const repRes = await fetch("/api/admin/relatorios/mes-atual", { cache: "no-store" }).then((r) => r.json());
      if (repRes?.error) {
        setErr(repRes.error);
        return;
      }
      setRep(repRes);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpis = useMemo(() => {
    const total = rep?.counts.total ?? 0;
    const final = rep?.counts.final ?? 0;
    const em_conf = rep?.counts.em_conferencia ?? 0;
    const em_and = rep?.counts.em_andamento ?? 0;
    const abertas = rep?.counts.aberta ?? 0;

    return [
      { label: "Auditorias do mês", value: total },
      { label: "Finalizadas", value: `${final} (${pct(final, total)})` },
      { label: "Em conferência", value: `${em_conf} (${pct(em_conf, total)})` },
      { label: "Em andamento", value: `${em_and} (${pct(em_and, total)})` },
      { label: "Abertas", value: `${abertas} (${pct(abertas, total)})` },
      { label: "Condomínios (cadastro)", value: rep?.condominios_total ?? 0 },
    ];
  }, [rep]);

  return (
    <AppShell>
  <div className="mx-auto max-w-5xl space-y-4">
    <h1 className="text-2xl font-bold">Relatórios (mês atual)</h1>
    ...

      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Relatório do mês atual</h1>
            <p className="text-sm text-muted-foreground">
              Visão gerencial rápida (Operação). Mês: <span className="font-mono">{rep?.mes_ref ?? "—"}</span>
            </p>
          </div>

          <button
            onClick={load}
            className="rounded-xl border bg-white px-4 py-2 text-sm shadow-sm hover:bg-muted disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        {!canSee && me && (
          <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">
            Sem permissão (apenas Interno/Gestor).
          </div>
        )}

        {err && <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">Erro: {err}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Logs do Job (criar auditorias mensais)</h2>
            <a className="text-sm underline" href="/auditorias/rodar">
              Ir para tela de execução
            </a>
          </div>

          {rep?.logs_error ? (
            <div className="mt-2 rounded-xl border bg-yellow-50 p-3 text-sm text-yellow-800">
              Aviso: não consegui carregar logs ({rep.logs_error})
            </div>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-3 py-2">Início</th>
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2">OK</th>
                  <th className="px-3 py-2">Ativos</th>
                  <th className="px-3 py-2">Criadas</th>
                  <th className="px-3 py-2">Erro</th>
                </tr>
              </thead>
              <tbody>
                {(rep?.logs ?? []).map((l: any) => (
                  <tr key={l.id} className="border-b">
                    <td className="px-3 py-2">{l.inicio ? new Date(l.inicio).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 font-mono">{l.mes_ref ?? "—"}</td>
                    <td className="px-3 py-2">{l.ok ? "✅" : "❌"}</td>
                    <td className="px-3 py-2">{l.condominios_ativos ?? "—"}</td>
                    <td className="px-3 py-2">{l.criadas ?? "—"}</td>
                    <td className="px-3 py-2 text-red-600">{l.erro ?? ""}</td>
                  </tr>
                ))}
                {(!rep?.logs || rep.logs.length === 0) && (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                      Sem logs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Próximos blocos (modelo)</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <b>Produtividade por auditor</b> (quantas finalizações / tempo médio).
            </li>
            <li>
              <b>Qualidade</b>: pendências, divergências, % em conferência por condomínio.
            </li>
            <li>
              <b>DRE</b> (Demonstração do Resultado do Exercício) da operação: precisa de tabelas de receitas/custos.
            </li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
