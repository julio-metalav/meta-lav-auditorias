"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";

type Implantacao = {
  id: string;
  nome_condominio: string;
  data_contrato: string;
  finalizada_em: string | null;
};

export default function ImplantacoesPage() {
  const [items, setItems] = useState<Implantacao[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/implantacoes", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error ?? "Erro ao carregar implantações");
        return;
      }
      setItems(json ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Implantações</h1>

          <Link
            href="/implantacoes/nova"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
          >
            + Nova implantação
          </Link>
        </div>

        {err && (
          <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">
            Erro: {err}
          </div>
        )}

        {loading && <div>Carregando…</div>}

        {!loading && items.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Nenhuma implantação em andamento.
          </div>
        )}

        <div className="space-y-2">
          {items.map((i) => (
            <Link
              key={i.id}
              href={`/implantacoes/${i.id}`}
              className="block rounded-xl border bg-white p-4 hover:bg-muted"
            >
              <div className="font-medium">{i.nome_condominio}</div>
              <div className="text-sm text-muted-foreground">
                Contrato: {new Date(i.data_contrato).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
