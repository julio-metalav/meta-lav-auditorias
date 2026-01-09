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

type FotoKind = "agua" | "energia" | "gas" | "quimicos" | "bombonas" | "conector_bala";

const FOTO_LABEL: Record<FotoKind, string> = {
  agua: "Medidor de Água",
  energia: "Medidor de Energia",
  gas: "Medidor de Gás (opcional)",
  quimicos: "Proveta (aferição de químicos)",
  bombonas: "Bombonas (detergente + amaciante na mesma foto)",
  conector_bala: "Conector bala conectado",
};

const kinds: FotoKind[] = ["agua", "energia", "gas", "quimicos", "bombonas", "conector_bala"];

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
    conector_bala: false,
  });

  // fluxo "tirou -> conferiu -> salvar"
  const [pendingFile, setPendingFile] = useState<Partial<Record<FotoKind, File>>>({});
  const [pendingUrl, setPendingUrl] = useState<Partial<Record<FotoKind, string>>>({});
  const [showPreview, setShowPreview] = useState<Record<FotoKind, boolean>>({
    agua: false,
    energia: false,
    gas: false,
    quimicos: false,
    bombonas: false,
    conector_bala: false,
  });

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
  }

  function fotoUrl(a: Aud | null, kind: FotoKind) {
    if (!a) return null;
    if (kind === "agua") return a.foto_agua_url ?? null;
    if (kind === "energia") return a.foto_energia_url ?? null;
    if (kind === "gas") return a.foto_gas_url ?? null;
    if (kind === "quimicos") return a.foto_quimicos_url ?? null;
    if (kind === "bombonas") return a.foto_bombonas_url ?? null;
    return a.foto_conector_bala_url ?? null;
  }

  function filenameFromFile(f?: File) {
    if (!f) return "";
    return f.name || "foto.jpg";
  }

  function shortUrl(u: string) {
    // mostra só o final, pra não poluir
    try {
      const parts = u.split("/");
      return parts.slice(-2).join("/");
    } catch {
      return u;
    }
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

  async function salvarRascunho(extra?: Partial<Pick<Aud, "status">>) {
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
          ...(extra ?? {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar");

      const saved: Aud | null = json?.auditoria ?? null;
      if (saved) {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));
        applyFromAud(saved);
      }

      setOkMsg(extra?.status ? "Concluída em campo ✅" : "Rascunho salvo ✅");
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

      const res = await fetch(`/api/auditorias/${id}/fotos`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao enviar foto");

      const saved: Aud | null = json?.auditoria ?? null;
      if (saved) setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));

      // limpa pendência + fecha preview
      const url = pendingUrl[kind];
      if (url) URL.revokeObjectURL(url);

      setPendingFile((p) => {
        const copy = { ...p };
        delete copy[kind];
        return copy;
      });
      setPendingUrl((p) => {
        const copy = { ...p };
        delete copy[kind];
        return copy;
      });
      setShowPreview((p) => ({ ...p, [kind]: false }));

      setOkMsg(`Foto salva ✅ (${FOTO_LABEL[kind]})`);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao enviar foto");
    } finally {
      setUploading((p) => ({ ...p, [kind]: false }));
    }
  }

  function onPick(kind: FotoKind, file?: File | null) {
    if (!file) return;

    const url = URL.createObjectURL(file);
    const old = pendingUrl[kind];
    if (old) URL.revokeObjectURL(old);

    setPendingFile((p) => ({ ...p, [kind]: file }));
    setPendingUrl((p) => ({ ...p, [kind]: url }));
    setShowPreview((p) => ({ ...p, [kind]: false })); // por padrão: NÃO mostrar foto
  }

  function cancelPending(kind: FotoKind) {
    const url = pendingUrl[kind];
    if (url) URL.revokeObjectURL(url);

    setPendingFile((p) => {
      const copy = { ...p };
      delete copy[kind];
      return copy;
    });
    setPendingUrl((p) => {
      const copy = { ...p };
      delete copy[kind];
      return copy;
    });
    setShowPreview((p) => ({ ...p, [kind]: false }));
  }

  const checklist = useMemo(() => {
    const a = aud;

    const leituraAguaOk = (leitura_agua ?? "").trim().length > 0;
    const leituraEnergiaOk = (leitura_energia ?? "").trim().length > 0;

    // gás é opcional sempre
    const fotoAguaOk = !!a?.foto_agua_url;
    const fotoEnergiaOk = !!a?.foto_energia_url;
    const fotoQuimicosOk = !!a?.foto_quimicos_url;
    const fotoBombonasOk = !!a?.foto_bombonas_url;
    const fotoConectorOk = !!a?.foto_conector_bala_url;

    const fotosObrigatoriasOk =
      fotoAguaOk && fotoEnergiaOk && fotoQuimicosOk && fotoBombonasOk && fotoConectorOk;

    const prontoCampo = leituraAguaOk && leituraEnergiaOk && fotosObrigatoriasOk;

    const faltas: string[] = [];
    if (!leituraAguaOk) faltas.push("Leitura de água");
    if (!leituraEnergiaOk) faltas.push("Leitura de energia");
    if (!fotoAguaOk) faltas.push("Foto do medidor de água");
    if (!fotoEnergiaOk) faltas.push("Foto do medidor de energia");
    if (!fotoQuimicosOk) faltas.push("Foto da proveta (químicos)");
    if (!fotoBombonasOk) faltas.push("Foto das bombonas (detergente+amaciante)");
    if (!fotoConectorOk) faltas.push("Foto do conector bala conectado");

    return { prontoCampo, faltas };
  }, [aud, leitura_agua, leitura_energia]);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
      Object.values(pendingUrl).forEach((u) => u && URL.revokeObjectURL(u));
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
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
      )}

      {ok && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>
      )}

      <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Conferência rápida (campo)</div>
            <div className="mt-1 text-xs text-gray-500">Gás é opcional. Fotos obrigatórias não aparecem na tela — só link.</div>

            {checklist.prontoCampo ? (
              <div className="mt-2 text-sm font-semibold text-green-700">✅ Campo concluído</div>
            ) : (
              <div className="mt-2 text-sm text-red-700">
                Faltando: <b>{checklist.faltas.join(", ")}</b>
              </div>
            )}
          </div>

          <button
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={!checklist.prontoCampo || saving || loading || !aud}
            onClick={() => salvarRascunho({ status: "final" })}
          >
            {saving ? "Salvando..." : "Concluir em campo ✅"}
          </button>
        </div>
      </div>

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
            <label className="mb-1 block text-xs text-gray-600">Leitura Gás (opcional)</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_gas}
              onChange={(e) => setLeituraGas(e.target.value)}
              placeholder="se não tiver, deixa vazio"
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
            placeholder="anote ocorrências, etc."
          />
        </div>

        <div className="mt-6 rounded-2xl border p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Fotos (6 slots)</div>
          <div className="text-xs text-gray-500">Fluxo: tirou → (opcional ver prévia) → salvar. Depois some e vira link.</div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {kinds.map((kind) => {
              const savedUrl = fotoUrl(aud, kind);
              const busy = uploading[kind];
              const pUrl = pendingUrl[kind];
              const pFile = pendingFile[kind];

              return (
                <div key={kind} className="rounded-2xl border p-3">
                  <div className="text-sm font-semibold">{FOTO_LABEL[kind]}</div>

                  {/* Área "clean": sem foto */}
                  <div className="mt-2 rounded-xl border bg-gray-50 p-3 text-sm">
                    {pFile ? (
                      <div className="text-gray-700">
                        <b>Pendente:</b> {filenameFromFile(pFile)}
                      </div>
                    ) : savedUrl ? (
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-gray-700">
                          <b>Salva ✅</b> <span className="text-xs text-gray-500">({shortUrl(savedUrl)})</span>
                        </div>
                        <a
                          className="rounded-lg border bg-white px-3 py-1 text-xs hover:bg-gray-100"
                          href={savedUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir
                        </a>
                      </div>
                    ) : (
                      <div className="text-gray-500">Sem foto</div>
                    )}
                  </div>

                  {/* Prévia opcional (só se pendente) */}
                  {pUrl && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => setShowPreview((p) => ({ ...p, [kind]: !p[kind] }))}
                      >
                        {showPreview[kind] ? "Ocultar prévia" : "Ver prévia"}
                      </button>

                      {showPreview[kind] && (
                        <div className="mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pUrl} alt={`${kind}-preview`} className="h-48 w-full rounded-xl object-cover" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ações */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      📷 Tirar foto
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          onPick(kind, e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                        disabled={busy}
                      />
                    </label>

                    <label className="cursor-pointer rounded-xl border px-4 py-2 text-sm hover:bg-gray-50">
                      🖼️ Galeria
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          onPick(kind, e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                        disabled={busy}
                      />
                    </label>

                    {pFile && (
                      <>
                        <button
                          type="button"
                          className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => uploadFoto(kind, pFile)}
                        >
                          {busy ? "Enviando..." : "Salvar ✅"}
                        </button>

                        <button
                          type="button"
                          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => cancelPending(kind)}
                        >
                          Refazer
                        </button>
                      </>
                    )}
                  </div>

                  {kind === "gas" && <div className="mt-2 text-xs text-gray-500">Opcional: se não existir gás, pode deixar sem.</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => salvarRascunho()}
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
