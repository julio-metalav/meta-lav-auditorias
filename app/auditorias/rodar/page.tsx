"use client";

import { useEffect, useState } from "react";

type LogRow = {
  id: string;
  job_name: string;
  mes_ref: string | null;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  condominios_ativos: number;
  criadas: number;
  result: any | null;
  error_message: string | null;
};

export default function RodarAuditoriasPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);

  async function runNow() {
    setErr(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await fetch("/api/admin/criar-auditorias", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Falha ao rodar");

      setResult(j.result ?? null);
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch (e: any) {
      setErr(e?.message ?? "Erro");
    } finally {
      setLoading(false);
    }
  }

  // Carrega “estado inicial” (sem criar nada) reaproveitando a mesma rota:
  // (faz POST só quando clicar; aqui deixamos vazio)
  useEffect(() => {
    // nada
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Criar auditorias do mês (manual)</h1>
          <p className="text-sm opacity-70">
            Executa <code className="px-1 py-0.5 rounded bg-black/5">public.criar_auditorias_mensais()</code> e mostra o log.
          </p>
        </div>

        <button
          onClick={runNow}
          disabled={loading}
          className="rounded-xl px-4 py-2 shadow-sm border bg-white hover:bg-black/5 disabled:opacity-50"
        >
          {loading ? "Rodando..." : "Rodar agora"}
        </button>
      </div>

      {err && (
        <div className="rounded-xl border p-3 bg-red-50 text-red-700">
          <b>Erro:</b> {err}
        </div>
      )}

      {result && (
        <div className="rounded-xl border p-3 bg-green-50">
          <div className="font-semibold">Resultado</div>
          <pre className="text-xs mt-2 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      <div className="rounded-2xl border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Últimos logs</div>
          <div className="text-xs opacity-60">Mostra os 20 mais recentes após rodar</div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/5">
              <tr>
                <th className="text-left p-3">Início</th>
                <th className="text-left p-3">Mês</th>
                <th className="text-left p-3">OK</th>
                <th className="text-left p-3">Ativos</th>
                <th className="text-left p-3">Criadas</th>
                <th className="text-left p-3">Erro</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td className="p-3 opacity-60" colSpan={6}>
                    Sem logs carregados ainda. Clique em <b>Rodar agora</b>.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-3 whitespace-nowrap">{new Date(l.started_at).toLocaleString()}</td>
                    <td className="p-3 whitespace-nowrap">{l.mes_ref ?? "-"}</td>
                    <td className="p-3 whitespace-nowrap">
                      {l.ok === true ? "✅" : l.ok === false ? "❌" : "-"}
                    </td>
                    <td className="p-3 whitespace-nowrap">{l.condominios_ativos}</td>
                    <td className="p-3 whitespace-nowrap">{l.criadas}</td>
                    <td className="p-3">
                      <span className="text-red-700">{l.error_message ?? ""}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs opacity-60">
        URL: <code className="px-1 py-0.5 rounded bg-black/5">/auditorias/rodar</code>
      </div>
    </div>
  );
}
