"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type PatchSuggestion = {
  file?: string;
  description: string;
  diff?: string;
  risk: "low" | "medium" | "high";
  verify: string[];
};

type DiagnosticoOutput = {
  summary: string;
  probable_causes: Array<{ cause: string; confidence: number; evidence: string[] }>;
  next_steps: string[];
  suggested_patches: PatchSuggestion[];
  safety_notes: string[];
  meta: { mode: "heuristic" | "ai"; remaining_rate_limit?: number };
};

export default function DiagnosticoPage() {
  const [title, setTitle] = useState("");
  const [route, setRoute] = useState("");
  const [method, setMethod] = useState("GET");
  const [logs, setLogs] = useState("");
  const [codeContext, setCodeContext] = useState("");
  const [repro, setRepro] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [envNotes, setEnvNotes] = useState("Vercel prod + Supabase. Não colar secrets.");

  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<DiagnosticoOutput | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const payload = useMemo(
    () => ({
      title,
      route,
      method,
      when: new Date().toISOString(),
      logs,
      code_context: codeContext,
      repro_steps: repro,
      expected,
      actual,
      env_notes: envNotes,
    }),
    [title, route, method, logs, codeContext, repro, expected, actual, envNotes]
  );

  async function run() {
    setLoading(true);
    setErr(null);
    setOut(null);
    try {
      const res = await fetch("/api/ia/diagnostico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Falha (${res.status})`);
      setOut(json);
    } catch (e: any) {
      setErr(e?.message ?? "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Diagnóstico de erro (IA / heurístico)</h1>
          <button
            onClick={run}
            disabled={loading}
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
          >
            {loading ? "Analisando..." : "Analisar"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="border rounded p-2"
            placeholder="Título (ex: PDF 500 / imagem branca)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="border rounded p-2"
            placeholder="Rota (ex: /api/.../pdf)"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
          />
          <select className="border rounded p-2" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>GET</option>
            <option>POST</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
        </div>

        <textarea
          className="border rounded p-2 w-full h-40 font-mono text-sm"
          placeholder="Cole aqui o runtime log / stack trace do Vercel (sem secrets)."
          value={logs}
          onChange={(e) => setLogs(e.target.value)}
        />

        <textarea
          className="border rounded p-2 w-full h-40 font-mono text-sm"
          placeholder="Cole trecho do código relevante (arquivo + linhas)."
          value={codeContext}
          onChange={(e) => setCodeContext(e.target.value)}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea
            className="border rounded p-2 w-full h-28"
            placeholder="Passos pra reproduzir"
            value={repro}
            onChange={(e) => setRepro(e.target.value)}
          />
          <textarea
            className="border rounded p-2 w-full h-28"
            placeholder="Notas de ambiente (ex: prod, supabase storage public, etc.)"
            value={envNotes}
            onChange={(e) => setEnvNotes(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea
            className="border rounded p-2 w-full h-24"
            placeholder="Esperado"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
          <textarea
            className="border rounded p-2 w-full h-24"
            placeholder="Atual"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>

        {err && <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div>}

        {out && (
          <div className="space-y-4">
            <div className="border rounded p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Resumo</div>
                <div className="text-sm opacity-70">
                  modo: {out.meta.mode} • restante: {out.meta.remaining_rate_limit ?? "—"}
                </div>
              </div>
              <div className="mt-2">{out.summary}</div>
            </div>

            <div className="border rounded p-3">
              <div className="font-semibold mb-2">Causas prováveis</div>
              <ul className="list-disc pl-5 space-y-2">
                {out.probable_causes.map((c, i) => (
                  <li key={i}>
                    <div className="font-medium">
                      {c.cause} <span className="opacity-70">(confiança {Math.round(c.confidence * 100)}%)</span>
                    </div>
                    {c.evidence?.length ? (
                      <ul className="list-disc pl-5 mt-1 opacity-80 text-sm">
                        {c.evidence.map((e, j) => (
                          <li key={j}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border rounded p-3">
              <div className="font-semibold mb-2">Patches sugeridos</div>
              <div className="space-y-3">
                {out.suggested_patches.map((p, i) => (
                  <div key={i} className="border rounded p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{p.description}</div>
                      <div className="text-sm opacity-70">risco: {p.risk}</div>
                    </div>
                    {p.file && <div className="text-sm opacity-70 mt-1">arquivo: {p.file}</div>}
                    {p.diff && (
                      <pre className="mt-2 p-2 bg-slate-50 border rounded overflow-auto text-xs">{p.diff}</pre>
                    )}
                    {p.verify?.length ? (
                      <ul className="list-disc pl-5 mt-2 text-sm">
                        {p.verify.map((v, j) => (
                          <li key={j}>{v}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
                {!out.suggested_patches.length && (
                  <div className="opacity-70">Sem patch automático — faltou sinal nos logs/código.</div>
                )}
              </div>
            </div>

            <div className="border rounded p-3">
              <div className="font-semibold mb-2">Próximos passos</div>
              <ul className="list-disc pl-5 space-y-1">
                {out.next_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="border rounded p-3">
              <div className="font-semibold mb-2">Notas de segurança</div>
              <ul className="list-disc pl-5 space-y-1">
                {out.safety_notes.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
