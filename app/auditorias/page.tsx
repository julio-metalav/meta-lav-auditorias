"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "auditor" | "interno" | "gestor";

type Condo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
};

type UserRow = {
  id: string;
  email: string | null;
  role: Role | null;
};

type Assignment = {
  auditor_id: string;
  condominio_id: string;
};

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  status: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  created_at?: string | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function pickMonth(aud: Aud) {
  return (aud.ano_mes ?? aud.mes_ref ?? monthISO()) as string;
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
    status: "aberta",
  });

  const condoLabel = useMemo(() => {
    const map = new Map<string, string>();
    condos.forEach((c) => map.set(c.id, `${c.nome} • ${c.cidade}/${c.uf}`));
    return map;
  }, [condos]);

  const auditorEmail = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => map.set(u.id, u.email ?? u.id));
    return map;
  }, [users]);

  const auditors = useMemo(() => users.filter((u) => u.role === "auditor"), [users]);

  const allowedAuditorsForCondo = useMemo(() => {
    if (!form.condominio_id) return auditors;

    const allowedIds = new Set(
      assignments.filter((a) => a.condominio_id === form.condominio_id).map((a) => a.auditor_id)
    );

    // se ainda não tem vínculo, mostra todos (pra não parecer “bugado”)
    if (allowedIds.size === 0) return auditors;

    return auditors.filter((u) => allowedIds.has(u.id));
  }, [auditors, assignments, form.condominio_id]);

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      const [cRes, uRes, aRes, audRes] = await Promise.all([
        fetch("/api/condominios", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/assignments", { cache: "no-store" }),
        fetch("/api/auditorias", { cache: "no-store" }),
      ]);

      const cJson = await cRes.json();
      const uJson = await uRes.json();
      const aJson = await aRes.json();
      const audJson = await audRes.json();

      if (!cRes.ok) throw new Error(cJson?.error ?? "Erro ao carregar condomínios");
      if (!uRes.ok) throw new Error(uJson?.error ?? "Erro ao carregar usuários");
      if (!aRes.ok) throw new Error(aJson?.error ?? "Erro ao carregar atribuições");
      if (!audRes.ok) throw new Error(audJson?.error ?? "Erro ao carregar auditorias");

      setCondos(Array.isArray(cJson) ? cJson : cJson?.data ?? []);
      setUsers(Array.isArray(uJson) ? uJson : uJson?.data ?? []);
      setAssignments(Array.isArray(aJson) ? aJson : aJson?.data ?? []);
      setAuditorias(Array.isArray(audJson) ? audJson : audJson?.data ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar dados");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectAuditoria(a: Aud) {
    setSelectedId(a.id);
    setForm({
      condominio_id: a.condominio_id,
      ano_mes: pickMonth(a),
      auditor_id: a.auditor_id ?? "",
      status: (a.status ?? "aberta") as string,
    });
    setErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setSelectedId(null);
    setForm({
      condominio_id: "",
      ano_mes: monthISO(),
      auditor_id: "",
      status: "aberta",
    });
    setErr(null);
  }

  async function criarOuAtualizar() {
    setErr(null);

    if (!form.condominio_id || !form.ano_mes || !form.auditor_id) {
      setErr("Campos obrigatórios: condomínio, mês (YYYY-MM-01), auditor");
      return;
    }

    setLoading(true);
    try {
      if (!selectedId) {
        const res = await fetch("/api/auditorias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            condominio_id: form.condominio_id,
            ano_mes: form.ano_mes,
            auditor_id: form.auditor_id,
            status: form.status,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao criar auditoria");
      } else {
        // (por enquanto) edição só no client-state; se precisar editar no banco, a gente cria um PATCH depois
        setErr("Edição ainda não implementada. (Clique 'voltar para Criar' e crie outra do mês.)");
      }

      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setLoading(false);
    }
  }

  function abrirAuditoriaAuditor(auditoriaId: string) {
    router.push(`/auditor/auditoria/${auditoriaId}`);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Auditorias</h1>
        <button
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={loadAll}
          disabled={loading}
        >
          Recarregar
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm text-gray-600">
          {selectedId ? (
            <>
              Auditoria selecionada <span className="font-mono">{selectedId}</span>{" "}
              <button className="ml-2 underline" onClick={resetForm}>
                (voltar para “Criar”)
              </button>
            </>
          ) : (
            <>Criar nova auditoria</>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Condomínio</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.condominio_id}
              onChange={(e) => setForm((p) => ({ ...p, condominio_id: e.target.value, auditor_id: "" }))}
            >
              <option value="">Selecione...</option>
              {condos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} • {c.cidade}/{c.uf}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Mês ref (YYYY-MM-01)</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={form.ano_mes}
              onChange={(e) => setForm((p) => ({ ...p, ano_mes: e.target.value }))}
              placeholder="2026-01-01"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Auditor</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.auditor_id}
              onChange={(e) => setForm((p) => ({ ...p, auditor_id: e.target.value }))}
            >
              <option value="">Selecione...</option>
              {allowedAuditorsForCondo.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email ?? u.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Status</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="aberta">aberta</option>
              <option value="em_conferencia">em_conferencia</option>
              <option value="final">final</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={criarOuAtualizar}
            disabled={loading}
          >
            {selectedId ? "Salvar alterações" : "Criar"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm text-gray-600">{auditorias.length} itens</div>

        {auditorias.length === 0 ? (
          <div className="text-sm text-gray-600">Nenhuma auditoria cadastrada.</div>
        ) : (
          <div className="space-y-3">
            {auditorias.map((a) => {
              const isSel = a.id === selectedId;
              const month = pickMonth(a);

              return (
                <div
                  key={a.id}
                  className={`w-full rounded-2xl border p-4 text-left ${
                    isSel ? "border-blue-400 ring-2 ring-blue-100" : ""
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-lg font-semibold">
                        {condoLabel.get(a.condominio_id) ?? a.condominio_id}
                      </div>
                      <div className="mt-1 text-sm text-gray-700">
                        Auditor: {a.auditor_id ? auditorEmail.get(a.auditor_id) ?? a.auditor_id : "—"} • mês{" "}
                        {month} • <span className="font-semibold">{a.status ?? "—"}</span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-gray-400">ID: {a.id}</div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                        onClick={() => selectAuditoria(a)}
                      >
                        Selecionar
                      </button>

                      <button
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        onClick={() => abrirAuditoriaAuditor(a.id)}
                      >
                        Abrir (Auditor)
                      </button>
                    </div>
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

