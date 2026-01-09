"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export default function InternoAuditoriaPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const auditoriaId = params.id;

  // 🚨 proteção contra /[id]
  if (!isUuid(auditoriaId)) {
    return (
      <div style={{ padding: 24 }}>
        <h2>ID de auditoria inválido</h2>
        <p style={{ marginTop: 8 }}>
          Esta página deve ser acessada a partir da lista de auditorias.
        </p>
        <button
          style={{ marginTop: 16 }}
          onClick={() => router.push("/auditorias")}
        >
          Voltar para Auditorias
        </button>
      </div>
    );
  }

  /* -------- abaixo é o fluxo normal (inalterado) -------- */

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/auditorias/${auditoriaId}/ciclos`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Erro ao carregar");
      setData(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [auditoriaId]);

  if (loading) return <div style={{ padding: 16 }}>Carregando…</div>;

  if (err)
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Erro: {err}
        <br />
        <button onClick={load} style={{ marginTop: 8 }}>
          Tentar novamente
        </button>
      </div>
    );

  return (
    <div style={{ padding: 16 }}>
      <h1>Auditoria (Interno)</h1>
      <p>Lançar ciclos por tipo (valor agregado).</p>

      {data.maquinas?.length === 0 && (
        <div style={{ marginTop: 16 }}>
          Nenhuma máquina cadastrada para este condomínio.
          <br />
          Cadastre em: <code>/condominios/&lt;id&gt;/maquinas</code>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        Total estimado: <strong>R$ 0,00</strong>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={() => router.push("/auditorias")}>Voltar</button>
      </div>
    </div>
  );
}
