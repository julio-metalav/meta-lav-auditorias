"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export default function AuditoriaRedirectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  const [msg, setMsg] = useState("Carregando…");

  useEffect(() => {
    if (!isUuid(id)) {
      setMsg("ID inválido.");
      return;
    }

    // ROTA GENÉRICA (MAPA OFICIAL):
    // Não decide permissão e não consulta /api/me.
    // Só encaminha para a tela operacional (interno), onde as regras reais ficam.
    router.replace(`/interno/auditoria/${id}`);
  }, [id, router]);

  return (
    <AppShell title="Auditoria">
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800 }}>Redirecionando…</div>
        <div className="small" style={{ marginTop: 6 }}>
          {msg}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => router.push("/auditorias")}>
            Voltar
          </button>

          <button className="btn" onClick={() => router.refresh()}>
            Recarregar
          </button>
        </div>
      </div>
    </AppShell>
  );
}
