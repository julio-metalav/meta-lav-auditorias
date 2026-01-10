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
type Usuario = { id: string; email?: string | null; role?: Role | null };

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

function unwrapData<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    condominio_id: "",
    ano_mes: monthISO(),
    auditor_id: "",
    status: "aberta",
  });

  // ✅ Mapa congelado: interno pode tudo (menos relatórios sensíveis)
  // então interno + gestor podem criar; auditor não.
  const canCreate = me?.role === "interno" || me?.role === "gestor";

  const openPath = useMemo(() => {
    // ✅ Interno entra como interno (mas pode fazer o que o auditor faz por outras telas também)
    if (me?.role === "auditor") return "auditor/auditoria";
    if (me?.role === "interno") return "interno/auditoria";
    return "auditoria"; // gestor (ou redirect inteligente decide)
  }, [me?.role]);

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      const mRes = await fetch("/api/me", { cache: "no-store" });
      const m = await mRes.json().catch(() => ({}));
      if (!mRes.ok) throw new Error(m?.error ?? "Erro em /api/me");
      if (m?.error) throw new Error(m.error);
      setMe(m);

      const aRes = await fetch("/api/auditorias", { cache: "no-store" });
      const a = await aRes.json().catch(() => ({}));
      if (!aRes.ok) throw new Error(a?.error ?? "Erro em /api/auditorias");
      if (a?.error) throw new Error(a.error);
      setAuditorias(unwrapData<Aud>(a));

      const cRes = await fetch("/api/condominios", { cache: "no-store" });
      const c = await cRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(c?.error ?? "Erro em /api/condominios");
      if (c?.error) throw new Error(c.error);
      setCondos(unwrapData<Condo>(c));

      // ✅ interno/gestor precisam listar usuários pra escolher auditor
      if (m?.role === "interno" || m?.role === "gestor") {
        const uRes = await fetch("/api/usuarios", { cache: "no-store" });
        const u = await uRes.json().catch(() => ({}));
        if (!uRes.ok) throw new Error(u?.error ?? "Erro em /api/usuarios");
        if (u?.error) throw new Error(u.error);

        const rawUsers = unwrapData<any>(u);
        const list = rawUsers.map((x: any) => ({
          id: x.id,
          email: x.email ?? x.profiles?.email ?? null,
          role: x.role ?? x.profiles?.role ?? null,
        }));
        setUsuarios(list);
      } else {
        setUsuarios([]);
      }
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
          {me?.role ? ` • você: ${me.role}` : ""}
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
                  <option value="em_andamento">em_andamento</option>
                  <option value="em_conferencia">em_conferencia</option>
                  <option value="final">final</option>
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
                {usuarios
                  .filter((u) => (u.role ?? "auditor") === "auditor")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email ?? u.id}
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
                <div style={{ fontWeight: 700 }}>{a.condominios?.nome ?? "Condomínio"}</div>
                <div className="small">
                  {a.condominios?.cidade ?? ""}/{a.condominios?.uf ?? ""} • {pickMonth(a) || "mês n/d"} • status:{" "}
                  <b>{a.status ?? "n/d"}</b>
                </div>
                <div className="small">Auditor: {a.profiles?.email ?? a.auditor_id ?? "n/d"}</div>
                <div className="small">ID: {a.id}</div>
              </div>

              <div className="row" style={{ alignItems: "center", justifyContent: "flex-end" }}>
                <button className="btn primary" onClick={() => router.push(`/${openPath}/${a.id}`)}>
                  Abrir
                </button>

                {/* Interno (e gestor) também podem abrir a tela do auditor (campo) se quiser */}
                {(me?.role === "interno" || me?.role === "gestor") && (
                  <button className="btn" onClick={() => router.push(`/auditor/auditoria/${a.id}`)}>
                    Abrir (Campo)
                  </button>
                )}
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
