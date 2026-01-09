"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;

  leitura_agua?: string | null;
  leitura_energia?: string | null;
  leitura_gas?: string | null;
  observacoes?: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;
  foto_quimicos_url?: string | null;
  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
};

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos"
  | "bombonas"
  | "conector_bala";

type FotoItem = {
  kind: FotoKind;
  label: string;
  required: boolean;
  help?: string;
};

const FOTO_ITEMS: FotoItem[] = [
  { kind: "agua", label: "Medidor de Água", required: true },
  { kind: "energia", label: "Medidor de Energia", required: true },
  { kind: "gas", label: "Medidor de Gás", required: false, help: "Opcional (se houver)" },
  { kind: "quimicos", label: "Proveta (aferição de químicos)", required: true },
  { kind: "bombonas", label: "Bombonas (detergente + amaciante)", required: true },
  { kind: "conector_bala", label: "Conector bala conectado", required: true },
];

export default function AuditorAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [aud, setAud] = useState<Aud | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const okTimer = useRef<number | null>(null);

  const [obs, setObs] = useState("");
  const [leitura_agua, setLeituraAgua] = useState("");
  const [leitura_energia, setLeituraEnergia] = useState("");
  const [leitura_gas, setLeituraGas] = useState("");

  // 👉 CONTROLE DO BOTÃO
  // dirty = true  -> CINZA "Salvar"
  // dirty = false -> VERDE "Salvo ✓"
  const [dirty, setDirty] = useState(false);

  const [uploading, setUploading] = useState<Record<FotoKind, boolean>>({
    agua: false,
    energia: false,
    gas: false,
    quimicos: false,
    bombonas: false,
    conector_bala: false,
  });

  const [pendingFile, setPendingFile] = useState<Partial<Record<FotoKind, File>>>({});
  const [pendingUrl, setPendingUrl] = useState<Partial<Record<FotoKind, string>>>({});
  const [previewKind, setPreviewKind] = useState<FotoKind | null>(null);

  function setOkMsg(msg: string) {
    setOk(msg);
    if (okTimer.current) window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setOk(null), 2500);
  }

  function applyFromAud(a: Aud) {
    setObs(a.observacoes ?? "");
    setLeituraAgua(a.leitura_agua ?? "");
    setLeituraEnergia(a.leitura_energia ?? "");
    setLeituraGas(a.leitura_gas ?? "");
    setDirty(false); // acabou de sincronizar com o banco
  }

  function fotoUrl(a: Aud | null, kind: FotoKind) {
    if (!a) return null;
    return (
      (kind === "agua" && a.foto_agua_url) ||
      (kind === "energia" && a.foto_energia_url) ||
      (kind === "gas" && a.foto_gas_url) ||
      (kind === "quimicos" && a.foto_quimicos_url) ||
      (kind === "bombonas" && a.foto_bombonas_url) ||
      (kind === "conector_bala" && a.foto_conector_bala_url) ||
      null
    );
  }

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/auditorias", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar");

      const list: Aud[] = Array.isArray(json) ? json : json?.data ?? [];
      const found = list.find((x) => x.id === id);
      if (!found) throw new Error("Auditoria não encontrada");

      setAud(found);
      applyFromAud(found);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function salvarRascunho(extra?: Partial<Pick<Aud, "status">>) {
    if (!aud) return;
    setSaving(true);
    setErr(null);

    try {
      const res = await fetch(`/api/auditorias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leitura_agua,
          leitura_energia,
          leitura_gas,
          observacoes: obs,
          ...(extra ?? {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar");

      setAud((p) => ({ ...(p ?? ({} as Aud)), ...(json.auditoria ?? {}) }));
      setDirty(false);
      setOkMsg(extra?.status ? "Concluída em campo ✅" : "Salvo ✓");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    carregar();
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
      Object.values(pendingUrl).forEach((u) => u && URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const titulo = aud?.condominios
    ? `${aud.condominios.nome} • ${aud.condominios.cidade}/${aud.condominios.uf}`
    : aud?.condominio_id ?? "";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Auditoria (Auditor)</h1>
      <div className="text-sm text-gray-600">{titulo}</div>

      {err && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm">{err}</div>}
      {ok && <div className="mt-3 rounded border border-green-200 bg-green-50 p-2 text-sm">{ok}</div>}

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className="rounded-xl border px-3 py-2"
            placeholder="Leitura água"
            value={leitura_agua}
            onChange={(e) => {
              setLeituraAgua(e.target.value);
              setDirty(true);
            }}
          />
          <input
            className="rounded-xl border px-3 py-2"
            placeholder="Leitura energia"
            value={leitura_energia}
            onChange={(e) => {
              setLeituraEnergia(e.target.value);
              setDirty(true);
            }}
          />
          <input
            className="rounded-xl border px-3 py-2"
            placeholder="Leitura gás (opcional)"
            value={leitura_gas}
            onChange={(e) => {
              setLeituraGas(e.target.value);
              setDirty(true);
            }}
          />
        </div>

        <textarea
          className="mt-3 w-full rounded-xl border px-3 py-2"
          rows={3}
          placeholder="Observações"
          value={obs}
          onChange={(e) => {
            setObs(e.target.value);
            setDirty(true);
          }}
        />

        <div className="mt-4 flex gap-3">
          <button
            className={`rounded-xl px-5 py-2 text-sm font-semibold text-white ${
              dirty ? "bg-gray-400 hover:bg-gray-500" : "bg-green-600"
            }`}
            disabled={!dirty || saving || loading}
            onClick={() => salvarRascunho()}
          >
            {saving ? "Salvando..." : dirty ? "Salvar" : "Salvo ✓"}
          </button>

          <a href="/auditorias" className="rounded-xl border px-5 py-2 text-sm">
            Voltar
          </a>
        </div>
      </div>
    </div>
  );
}
