"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

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
    async function go() {
      if (!isUuid(id)) {
        setMsg("ID inválido.");
        return;
      }

      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "Não autenticado");

        const role = (j?.role ?? null) as Role | null;

        if (role === "auditor") {
          router.replace(`/auditor/auditoria/${id}`);
          return;
        }

        if (role === "interno") {
          router.replace(`/interno/auditoria/${id}`);
          return;
        }

        if (role === "gestor") {
          router.replace(`/interno/auditoria/${id}`);
          return;
        }

        setMsg("Sem permissão.");
      } catch (e: any) {
        setMsg(e?.message ?? "Erro ao redirecionar");
      }
    }

    go();
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
