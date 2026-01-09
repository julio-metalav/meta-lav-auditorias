"use client";

import { useEffect, useRef, useState } from "react";

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

  condominios?: { nome: string; cidade: string; uf: string } | null;
};

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

type FotoKind = "agua" | "energia" | "gas" | "quimicos" | "bombonas";

const FOTO_LABEL: Record<FotoKind, string> = {
  agua: "Medidor de Água",
  energia: "Medidor de Energia",
  gas: "Medidor de Gás (se houver)",
  quimicos: "Proveta (aferição de químicos)",
  bombonas: "Bombonas (detergente + amaciante na mesma foto)",
};

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

  const [uploading, setUploading] = useState<Record<FotoKind, boolean>>({
    agua: false,
    energia: false,
    gas: false,
    quimicos: false,
    bombonas: false,
  });

  function applyFromAud(a: Aud) {
    setObs(a.observacoes ?? "");
    setLeituraAgua(a.leitura_agua ?? "");
    setLeituraEnergia(a.leitura_energia ?? "");
    setLeituraGas(a.leitura_gas ?? "");
  }

  function setOkMsg(msg: string) {
    setOk(msg);
    if (okTimer.current) window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setOk(null), 2500);
  }

  async function carregar() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const res = await fetch("/api/auditorias", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditorias");

      const list: Aud[] = Array.isArray(json) ? json : json?.data ?? [];
      const found = list.find((x) => x.id === id);

      if (!found) throw new Error("Auditoria não encontrada (id inválido ou você não tem acesso).");

      setAud(found);
      applyFromAud(found);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function salvarRascunho() {
    setErr(null);
    setOk(null);

    if (!aud) {
      setErr("Auditoria não carregada.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/auditorias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leitura_agua,
          leitura_energia,
          leitura_gas,
          observacoes: obs,
        }),
      });

      const json = await res.json();

      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar rascunho");

      const saved: Aud | null = json?.auditoria ?? null;

      if (saved) {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));
        applyFromAud(saved);
      } else {
        setAud((prev) =>
          prev
            ? {
                ...prev,
                leitura_agua,
                leitura_energia,
                leitura_gas,
                observacoes: obs,
              }
            : prev
        );
      }

      setOkMsg("Rascunho salvo ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFoto(kind: FotoKind, file: File) {
    setErr(null);
    setOk(null);

    if (!file.type.startsWith("image/")) {
      setErr("Envie apenas imagem.");
      return;
    }

    setUploading((p) => ({ ...p, [kind]: true }));
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);

      const res = await fetch(`/api/auditorias/${id}/fotos`, {
        method: "POST",
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao enviar foto");

      const saved: Aud | null = json?.auditoria ?? null;
      if (saved) setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));

      setOkMsg(`Foto enviada ✅ (${FOTO_LABEL[kind]})`);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao enviar foto");
    } finally {
      setUploading((p) => ({ ...p, [kind]: false }));
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
    };
  }, []);

  const titulo = aud?.condominios
    ? `${aud.condominios.nome} • ${aud.condominios.cidade}/${aud.condominios.uf}`
    : aud?.condominio_id ?? "";

  const fotoUrl = (a: Aud | null, kind: FotoKind) => {
    if (!a) return null;
    if (kind === "agua") return a.foto_agua_url ?? null;
    if (kind === "energia") return a.foto_energia_url ?? null;
    if (kind === "gas") return a.foto_gas_url ?? null;
    if (kind === "quimicos") return a.foto_quimicos_url ?? null;
    return a.foto_bombonas_url ?? null;
  };

  const kinds: FotoKind[] = ["agua", "energia", "gas", "quimicos", "bombonas"];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria (Auditor)</h1>
          <div className="text-sm text-gray-600">{titulo}</div>
          <div className="mt-1 text-xs text-gray-500">
            Mês: <b>{aud ? pickMonth(aud) : "-"}</b> • Status: <b>{aud?.status ?? "-"}</b>
          </div>
          <div className="mt-1 font-mono text-xs text-gray-400">ID: {id}</div>
        </div>

        <button
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={carregar}
          disabled={loading || saving}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
      )}

      {ok && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-700">Leituras</div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Água</label>
            <input className="w-full rounded-xl border px-3 py-2" value={leitura_agua} onChange={(e) => setLeituraAgua(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Energia</label>
            <input className="w-full rounded-xl border px-3 py-2" value={leitura_energia} onChange={(e) => setLeituraEnergia(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Gás</label>
            <input className="w-full rounded-xl border px-3 py-2" value={leitura_gas} onChange={(e) => setLeituraGas(e.target.value)} />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-gray-600">Observações</label>
          <textarea className="w-full rounded-xl border px-3 py-2" value={obs} onChange={(e) => setObs(e.target.value)} rows={4} />
        </div>

        <div className="mt-6 rounded-2xl border p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Fotos (5 obrigatórias)</div>
          <div className="text-xs text-gray-500">
            No celular: ao tocar em “Tirar foto”, abre a câmera. Depois que tirar, envia e salva na auditoria.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {kinds.map((kind) => {
              const url = fotoUrl(aud, kind);
              const busy = uploading[kind];

              return (
                <div key={kind} className="rounded-2xl border p-3">
                  <div className="text-sm font-semibold">{FOTO_LABEL[kind]}</div>

                  <div className="mt-2">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={kind} className="h-48 w-full rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-48 items-center justify-center rounded-xl border bg-gray-50 text-sm text-gray-500">
                        Sem foto
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      {busy ? "Enviando..." : "Tirar foto"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          uploadFoto(kind, f);
                          e.currentTarget.value = "";
                        }}
                        disabled={busy}
                      />
                    </label>

                    <label className="cursor-pointer rounded-xl border px-4 py-2 text-sm hover:bg-gray-50">
                      {busy ? "Enviando..." : "Escolher da galeria"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          uploadFoto(kind, f);
                          e.currentTarget.value = "";
                        }}
                        disabled={busy}
                      />
                    </label>
                  </div>

                  {kind === "gas" && (
                    <div className="mt-2 text-xs text-gray-500">
                      Se não existir gás no condomínio, pode deixar sem foto.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={salvarRascunho}
            disabled={saving || loading || !aud}
          >
            {saving ? "Salvando..." : "Salvar rascunho"}
          </button>

          <a className="rounded-xl border px-5 py-2 text-sm hover:bg-gray-50" href="/auditorias">
            Voltar
          </a>
        </div>
      </div>
    </div>
  );
}
