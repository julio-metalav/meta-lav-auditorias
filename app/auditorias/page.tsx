"use client";

import { useEffect, useMemo, useState } from "react";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;
  created_at?: string | null;
  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null; role?: string | null } | null; // join do /api/auditorias
};

async function safeReadJson(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text().catch(() => "");
  if (!text) return {};
  if (!ct.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function pickMonth(a: Aud) {
  return String(a.ano_mes ?? a.mes_ref ?? "").slice(0, 10);
}

function statusLabel(s: string | null | undefined) {
  const x = String(s ?? "").trim().toLowerCase();
  if (!x) return "—";
  if (x === "aberta") return "Aberta";
  if (x === "em_andamento") return "Em andamento";
  if (x === "em_conferencia") return "Em conferência";
  if (x === "final") return "Final";
  return x;
}

function canReopenStatus(s: string | null | undefined) {
  const x = String(s ?? "").trim().toLowerCase();
  return x === "em_conferencia" || x === "final";
}

export default function AuditoriasPage() {
  const [list, setList] = useState<Aud[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/auditorias", { cache: "no-store" });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditorias");

      const arr: Aud[] = Array.isArray(json) ? json : json?.data ?? [];
      setList(arr);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function reabrir(auditoriaId: string) {
    setErr(null);
    setOk(null);
    setBusyId(auditoriaId);

    try {
      const res = await fetch(`/api/auditorias/${auditoriaId}/reabrir`, { method: "POST" });
      const json = await safeReadJson(res);

      if (!res.ok) {
        const raw = json?._raw ? ` (${String(json._raw).slice(0, 140)})` : "";
        throw new Error((json?.error ?? "Erro ao reabrir") + raw);
      }

      setOk("Auditoria reaberta ✅");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao reabrir");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return [...list].sort((a, b) => String(b.mes_ref ?? "").localeCompare(String(a.mes_ref ?? "")));
  }, [list]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auditorias</h1>
          <div className="text-sm text-gray-600">Lista (interno/gestor)</div>
        </div>

        <button
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={load}
          disabled={loading || !!busyId}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-2 border-b px-4 py-3 text-xs font-semibold text-gray-600">
          <div className="col-span-4">Condomínio</div>
          <div className="col-span-2">Mês</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Auditor</div>
          <div className="col-span-2 text-right">Ações</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">{loading ? "Carregando..." : "Nenhuma auditoria."}</div>
        ) : (
          <div className="divide-y">
            {rows.map((a) => {
              const condo = a.condominios
                ? `${a.condominios.nome} • ${a.condominios.cidade}/${a.condominios.uf}`
                : a.condominio_id;

              const auditorEmail = a.profiles?.email ?? a.auditor_id ?? "—";
              const canReopen = canReopenStatus(a.status);
              const busy = busyId === a.id;

              return (
                <div key={a.id} className="grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm">
                  <div className="col-span-4 min-w-0">
                    <div className="truncate font-semibold text-gray-800">{condo}</div>
                    <div className="mt-1 truncate font-mono text-xs text-gray-400">{a.id}</div>
                  </div>

                  <div className="col-span-2 text-gray-700">{pickMonth(a)}</div>

                  <div className="col-span-2">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                      {statusLabel(a.status)}
                    </span>
                  </div>

                  <div className="col-span-2 truncate text-xs text-gray-600">{auditorEmail}</div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <a
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
                      href={`/auditor/auditoria/${a.id}`}
                    >
                      Abrir
                    </a>

                    <button
                      className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      disabled={!canReopen || loading || busy}
                      onClick={() => {
                        const ok = window.confirm(
                          "Reabrir auditoria?\nIsso permitirá que o auditor altere leituras/fotos novamente."
                        );
                        if (ok) reabrir(a.id);
                      }}
                      title={canReopen ? "Reabrir (volta para Em andamento)" : "Só reabre quando está Em conferência/Final"}
                    >
                      {busy ? "..." : "Reabrir"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
