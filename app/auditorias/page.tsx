"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import { useRouter } from "next/navigation";

type Role = "auditor" | "interno" | "gestor";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type Condo = { id: string; nome: string; cidade: string; uf: string };
type Auditor = { id: string; email?: string | null; role?: Role | null };

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;
  created_at?: string | null;
  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null; role?: Role | null } | null;
};

function monthISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [auditores, setAuditores] = useState<Auditor[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
    status: "aberta",
  });

  const canCreate = me?.role === "gestor" || me?.role === "interno";

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [m, a, c, u] = await Promise.all([
        fetch("/api/me", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/auditorias", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/condominios", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/users", { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (m?.error) throw new Error(m.error);
      setMe(m);

      if (a?.error) throw new Error(a.error);
      setAuditorias(a.data || []);

      if (c?.error) throw new Error(c.error);
      setCondos(c.data || []);

      if (u?.error) throw new Error(u.error);
      // /api/users costuma devolver data com profiles; aqui só pegamos o básico
      const list = (u.data || []).map((x: any) => ({
        id: x.id,
        email: x.email ?? x.profiles?.email ?? null,
        role: x.role ?? x.profiles?.role ?? null,
      }));
      setAuditores(list);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const condoLabel = useMemo(() => {
    const c = condos.find((x) => x.id === form.condominio_id);
    return c ? `${c.nome} — ${c.cidade}/${c.uf}` : "";
  }, [form.condominio_id, condos]);

  async function criarAuditoria() {
    setErr(null);
    if (!form.condominio_id) return setErr("Selecione o condomínio");
    if (!form.ano_mes) return setErr("Selecione o mês");
    if (!form.auditor_id) return setErr("Selecione o auditor");

    try {
      const r = await fetch("/api/auditorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condominio_id: form.condominio_id,
          ano_mes: form.ano_mes,
          auditor_id: form.auditor_id,
          status: form.status,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Erro ao criar auditoria");

      // reset mínimo
      setForm((s) => ({ ...s, status: "aberta" }));
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar auditoria");
    }
  }

  return (
    <AppShell title="Auditorias">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small">
          {loading ? "Carregando..." : `${auditorias.length} auditorias`}
        </div>
        <button className="btn" onClick={loadAll} disabled={loading}>
          Recarregar
        </button>
      </div>

      {err && <p style={{ color: "#b42318" }}>{err}</p>}

      {canCreate && (
        <div className="card" style={{ background: "#fbfcff", marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8 }}>
            Criar auditoria
          </div>

          <div className="grid2">
            <div>
              <div className="small">Condomínio</div>
              <select
                className="input"
                value={form.condominio_id}
                onChange={(e) => setForm({ ...form, condominio_id: e.target.value })}
              >
                <option value="">Selecione...</option>
                {condos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} — {c.cidade}/{c.uf}
                  </option>
                ))}
              </select>
              {condoLabel && <div className="small" style={{ marginTop: 6 }}>{condoLabel}</div>}
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 190 }}>
                <div className="small">Mês (YYYY-MM-01)</div>
                <input
                  className="input"
                  value={form.ano_mes}
                  onChange={(e) => setForm({ ...form, ano_mes: e.target.value })}
                  placeholder="2026-01-01"
                />
              </div>

              <div style={{ flex: 1, minWidth: 190 }}>
                <div className="small">Status</div>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="aberta">aberta</option>
                  <option value="em_conferencia">em_conferencia</option>
                  <option value="fechada">fechada</option>
                </select>
              </div>
            </div>

            <div>
              <div className="small">Auditor</div>
              <select
                className="input"
                value={form.auditor_id}
                onChange={(e) => setForm({ ...form, auditor_id: e.target.value })}
              >
                <option value="">Selecione...</option>
                {auditores
                  .filter((a) => (a.role ?? "auditor") === "auditor")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email ?? a.id}
                    </option>
                  ))}
              </select>
            </div>

            <div className="row" style={{ justifyContent: "flex-end", alignItems: "flex-end" }}>
              <button
                className="btn primary"
                onClick={criarAuditoria}
                disabled={loading || !form.condominio_id || !form.ano_mes || !form.auditor_id}
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      <hr className="hr" />

      <div className="list">
        {auditorias.map((a) => (
          <div key={a.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {a.condominios?.nome ?? "Condomínio"}
                </div>
                <div className="small">
                  {a.condominios?.cidade ?? ""}/{a.condominios?.uf ?? ""} •{" "}
                  {pickMonth(a) || "mês n/d"} • status: <b>{a.status ?? "n/d"}</b>
                </div>
                <div className="small">
                  Auditor: {a.profiles?.email ?? a.auditor_id ?? "n/d"}
                </div>
                <div className="small">ID: {a.id}</div>
              </div>

              <div className="row" style={{ alignItems: "center", justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => router.push(`/auditor/auditoria/${a.id}`)}>
                  Abrir (Auditor)
                </button>

                {/* ✅ AQUI ESTÁ A CORREÇÃO: usa auditoria.id (NÃO condominio_id) */}
                <button className="btn" onClick={() => router.push(`/interno/auditoria/${a.id}`)}>
                  Abrir (Interno)
                </button>
              </div>
            </div>
          </div>
        ))}

        {auditorias.length === 0 && (
          <div className="small" style={{ opacity: 0.8 }}>
            Nenhuma auditoria ainda.
          </div>
        )}
      </div>
    </AppShell>
  );
}
