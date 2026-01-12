"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor" | null;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function roleRank(r: Role) {
  if (r === "auditor") return 1;
  if (r === "interno") return 2;
  if (r === "gestor") return 3;
  return 0;
}

export default function AuditoriaRedirectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  const [msg, setMsg] = useState("Carregando…");

  useEffect(() => {
    let dead = false;

    async function go() {
      try {
        if (!isUuid(id)) {
          setMsg("ID inválido.");
          return;
        }

        setMsg("Verificando perfil…");

        const meRes = await fetch("/api/me", { cache: "no-store" });
        const meJson = await meRes.json().catch(() => ({}));

        if (!meRes.ok) {
          setMsg("Sessão inválida. Redirecionando para login…");
          router.replace("/login");
          return;
        }

        const role = (meJson?.role ?? null) as Role;

        // REGRA DEFINITIVA:
        // auditor -> tela de campo
        // interno/gestor -> tela operacional
        if (roleRank(role) >= roleRank("interno")) {
          router.replace(`/interno/auditoria/${id}`);
        } else {
          router.replace(`/auditor/auditoria/${id}`);
        }
      } catch (_e) {
        if (!dead) setMsg("Erro inesperado ao redirecionar.");
      }
    }

    go();

    return () => {
      dead = true;
    };
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
