"use client";

import { useEffect, useRef, useState } from "react";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;
  created_at?: string | null;

  leitura_agua?: string | null;
  leitura_energia?: string | null;
  leitura_gas?: string | null;
  observacoes?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { email?: string | null } | null;
};

type LocalPhoto = {
  id: string;
  file: File;
  url: string; // object URL para preview
};

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

  // Fotos (apenas preview local por enquanto)
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

      if (!res.ok) {
        throw new Error(json?.error ?? "Erro ao salvar rascunho");
      }

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

      // Importante: fotos ainda NÃO salvam no banco (só preview local)
      setOkMsg("Rascunho salvo ✅ (fotos ainda são só preview)");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const next: LocalPhoto[] = [];
    for (const file of Array.from(files)) {
      // aceita só imagens
      if (!file.type.startsWith("image/")) continue;

      const url = URL.createObjectURL(file);
      next.push({ id: uid(), file, url });
    }

    if (next.length === 0) return;

    setPhotos((prev) => [...prev, ...next]);

    // permite selecionar os mesmos arquivos de novo depois
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(photoId: string) {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === photoId);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((p) => p.id !== photoId);
    });
  }

  function clearPhotos() {
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
      // limpa objectURLs
      photos.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titulo = aud?.condominios
    ? `${aud.condominios.nome} • ${aud.condominios.cidade}/${aud.condominios.uf}`
    : aud?.condominio_id ?? "";

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
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {ok && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {ok}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-700">Leituras</div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Água</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_agua}
              onChange={(e) => setLeituraAgua(e.target.value)}
              placeholder="ex: 12345"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Energia</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_energia}
              onChange={(e) => setLeituraEnergia(e.target.value)}
              placeholder="ex: 67890"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Gás</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_gas}
              onChange={(e) => setLeituraGas(e.target.value)}
              placeholder="ex: 222"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-gray-600">Observações</label>
          <textarea
            className="w-full rounded-xl border px-3 py-2"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={4}
            placeholder="anote ocorrências, fotos pendentes, máquina com ruído, etc."
          />
        </div>

        {/* FOTOS (preview local) */}
        <div className="mt-6 rounded-2xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-700">Fotos (rascunho)</div>
            <div className="text-xs text-gray-500">Por enquanto: só preview. Próximo passo: salvar no Supabase.</div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
              className="text-sm"
            />

            <button
              type="button"
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
            >
              Adicionar fotos
            </button>

            <button
              type="button"
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={clearPhotos}
              disabled={photos.length === 0}
            >
              Limpar fotos
            </button>

            <div className="ml-auto text-sm text-gray-600">{photos.length} selecionada(s)</div>
          </div>

          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {photos.map((p) => (
                <div key={p.id} className="rounded-xl border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="foto" className="h-32 w-full rounded-lg object-cover" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="truncate text-xs text-gray-600" title={p.file.name}>
                      {p.file.name}
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                      onClick={() => removePhoto(p.id)}
                      title="Remover"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
