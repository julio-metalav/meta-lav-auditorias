"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;
  created_at?: string | null;
  condominios?: {
    nome: string;
    cidade: string;
    uf: string;
  } | null;
};

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "").slice(0, 7);
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/auditorias", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Erro ao carregar");
      setAuditorias(j ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div style={{ padding: 16 }}>Carregando…</div>;
  }

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", marginBottom: 8 }}>Erro: {err}</div>
        <button onClick={load}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Auditorias</h1>

      {auditorias.length === 0 ? (
        <div>Nenhuma auditoria cadastrada.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {auditorias.map((a) => (
            <div
              key={a.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {a.condominios?.nome ?? "Condomínio"}
                </div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {a.condominios?.cidade}/{a.condominios?.uf} •{" "}
                  {pickMonth(a)} • status: {a.status ?? "-"}
                </div>
              </div>

              {/* Auditor */}
              <button
                onClick={() => router.push(`/auditor/auditoria/${a.id}`)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              >
                Abrir (Auditor)
              </button>

              {/* Interno */}
              <button
                onClick={() => router.push(`/interno/auditoria/${a.id}`)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              >
                Abrir (Interno)
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
