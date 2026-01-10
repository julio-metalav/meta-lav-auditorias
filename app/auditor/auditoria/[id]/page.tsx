"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: Status | string | null;

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

type Me = { id: string; email: string | null; name: string | null };
type UserRow = { id: string; email: string | null };

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

type FotoKind = "agua" | "energia" | "gas" | "quimicos" | "bombonas" | "conector_bala";
type FotoItem = { kind: FotoKind; label: string; required: boolean; help?: string };

const FOTO_ITEMS: FotoItem[] = [
  { kind: "agua", label: "Medidor de Água", required: true },
  { kind: "energia", label: "Medidor de Energia", required: true },
  { kind: "gas", label: "Medidor de Gás", required: false, help: "Opcional (se houver gás)" },
  { kind: "quimicos", label: "Proveta (aferição de químicos)", required: true },
  { kind: "bombonas", label: "Bombonas (detergente + amaciante)", required: true, help: "Uma foto com as duas bombonas" },
  { kind: "conector_bala", label: "Conector bala conectado", required: true },
];

export default function AuditorAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [aud, setAud] = useState<Aud | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const okTimer = useRef<number | null>(null);

  const [obs, setObs] = useState("");
  const [leitura_agua, setLeituraAgua] = useState("");
  const [leitura_energia, setLeituraEnergia] = useState("");
  const [leitura_gas, setLeituraGas] = useState("");

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
    setDirty(false);
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

  const userEmailById = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.email ?? u.id));
    return m;
  }, [users]);

  const assignedAuditorLabel = useMemo(() => {
    if (!aud?.auditor_id) return "—";
    return userEmailById.get(aud.auditor_id) ?? aud.auditor_id;
  }, [aud?.auditor_id, userEmailById]);

  const meLabel = useMemo(() => {
    if (!me) return "—";
    const who = me.name ? `${me.name} (${me.email ?? me.id})` : me.email ?? me.id;
    return who;
  }, [me]);

  const mismatch = useMemo(() => {
    if (!me?.id) return false;
    if (!aud?.auditor_id) return false;
    return me.id !== aud.auditor_id;
  }, [me?.id, aud?.auditor_id]);

  const status = (aud?.status ?? null) as Status | null;
  const readOnlyByStatus = status === "em_conferencia" || status === "final";

  async function carregarTudo() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      // 1) quem está logado
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await meRes.json();
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário logado");
      setMe(meJson);

      // 2) lista de users (pra traduzir auditor_id -> email) (se falhar, não quebra)
      try {
        const uRes = await fetch("/api/users", { cache: "no-store" });
        const uJson = await uRes.json();
        if (uRes.ok) setUsers(Array.isArray(uJson) ? uJson : uJson?.data ?? []);
      } catch {
        // ignora
      }

      // 3) auditoria (detalhe)
      const res = await fetch(`/api/auditorias/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditoria");

      const found: Aud | null = json?.auditoria ?? json ?? null;
      if (!found?.id) throw new Error("Auditoria não encontrada.");

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

    if (!aud) return setErr("Auditoria não carregada.");
    if (mismatch) {
      return setErr(
        `Sem permissão: você está logado como "${meLabel}", mas esta auditoria é de "${assignedAuditorLabel}".`
      );
    }
    if (readOnlyByStatus) {
      return setErr("Esta auditoria está em conferência/final. Auditor não pode mais editar.");
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
      } else {
        setDirty(false);
      }

      setOkMsg(extra?.status ? "Concluída em campo ✅ (enviada para conferência)" : "Rascunho salvo ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function onPick(kind: FotoKind, file?: File | null) {
    if (!file) return;

    const url = URL.createObjectURL(file);
    const old = pendingUrl[kind];
    if (old) URL.revokeObjectURL(old);

    setPendingFile((p) => ({ ...p, [kind]: file }));
    setPendingUrl((p) => ({ ...p, [kind]: url }));
    setPreviewKind(null);
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

    if (previewKind === kind) setPreviewKind(null);
  }

  async function uploadFoto(kind: FotoKind, file: File) {
    setErr(null);
    setOk(null);

    if (!aud) return setErr("Auditoria não carregada.");
    if (mismatch) {
      return setErr(
        `Sem permissão: você está logado como "${meLabel}", mas esta auditoria é de "${assignedAuditorLabel}".`
      );
    }
    if (readOnlyByStatus) {
      return setErr("Esta auditoria está em conferência/final. Auditor não pode mais editar.");
    }
    if (!file.type.startsWith("image/")) return setErr("Envie apenas imagem.");

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

      if (previewKind === kind) setPreviewKind(null);

      setOkMsg("Foto salva ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao enviar foto");
    } finally {
      setUploading((p) => ({ ...p, [kind]: false }));
    }
  }

  const checklist = useMemo(() => {
    const a = aud;

    const leituraAguaOk = (leitura_agua ?? "").trim().length > 0;
    const leituraEnergiaOk = (leitura_energia ?? "").trim().length > 0;

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
    if (!fotoAguaOk) faltas.push("Foto água");
    if (!fotoEnergiaOk) faltas.push("Foto energia");
    if (!fotoQuimicosOk) faltas.push("Foto proveta");
    if (!fotoBombonasOk) faltas.push("Foto bombonas");
    if (!fotoConectorOk) faltas.push("Foto conector");

    return { prontoCampo, faltas };
  }, [aud, leitura_agua, leitura_energia]);

  useEffect(() => {
    carregarTudo();
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

  const disableAll = loading || saving || !aud || mismatch || readOnlyByStatus;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria (Auditor)</h1>
          <div className="text-sm text-gray-600">{titulo}</div>

          <div className="mt-2 rounded-xl border bg-white p-3 text-xs">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-gray-700">
                <b>Logado como:</b> {meLabel}
              </div>
              <div className="text-gray-700">
                <b>Auditoria atribuída a:</b> {assignedAuditorLabel}
              </div>
            </div>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            Mês: <b>{aud ? pickMonth(aud) : "-"}</b> • Status: <b>{aud?.status ?? "-"}</b>
            {readOnlyByStatus && (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700">
                Read-only (conferência/final)
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-xs text-gray-400">ID: {id}</div>
        </div>

        <button
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={carregarTudo}
          disabled={loading || saving}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {mismatch && (
        <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <b>Atenção:</b> você está logado como <b>{meLabel}</b>, mas esta auditoria pertence a{" "}
          <b>{assignedAuditorLabel}</b>.
          <div className="mt-1 text-xs text-red-700">
            Para lançar dados em campo, faça login com o usuário correto (o auditor atribuído).
          </div>
        </div>
      )}

      {readOnlyByStatus && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800">
          Esta auditoria está em <b>{aud?.status}</b>. O auditor não edita mais. (Somente interno/gestor na conferência.)
        </div>
      )}

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

      <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Conferência (campo)</div>
            {checklist.prontoCampo ? (
              <div className="mt-1 text-sm font-semibold text-green-700">✅ Campo pronto</div>
            ) : (
              <div className="mt-1 text-sm text-red-700">
                Faltando: <b>{checklist.faltas.join(", ")}</b>
              </div>
            )}
            <div className="mt-1 text-xs text-gray-500">Gás é opcional.</div>
          </div>

          <button
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={!checklist.prontoCampo || disableAll}
            onClick={() => salvarRascunho({ status: "em_conferencia" })}
            title="Ao concluir, vai para conferência do interno"
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
              onChange={(e) => {
                setLeituraAgua(e.target.value);
                setDirty(true);
              }}
              placeholder="ex: 12345"
              disabled={disableAll}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Energia</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_energia}
              onChange={(e) => {
                setLeituraEnergia(e.target.value);
                setDirty(true);
              }}
              placeholder="ex: 67890"
              disabled={disableAll}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Leitura Gás (opcional)</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={leitura_gas}
              onChange={(e) => {
                setLeituraGas(e.target.value);
                setDirty(true);
              }}
              placeholder="se não tiver, deixa vazio"
              disabled={disableAll}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-gray-600">Observações</label>
          <textarea
            className="w-full rounded-xl border px-3 py-2"
            value={obs}
            onChange={(e) => {
              setObs(e.target.value);
              setDirty(true);
            }}
            rows={3}
            placeholder="anote ocorrências, etc."
            disabled={disableAll}
          />
        </div>

        <div className="mt-6 rounded-2xl border p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Fotos (checklist)</div>
          <div className="text-xs text-gray-500">
            “📷 Tirar” → depois “Salvar ✅”. (RLS = Row Level Security já está OK.)
          </div>

          <div className="mt-3 divide-y rounded-xl border">
            {FOTO_ITEMS.map((item) => {
              const savedUrl = fotoUrl(aud, item.kind);
              const saved = !!savedUrl;
              const pend = !!pendingFile[item.kind];
              const busy = uploading[item.kind];
              const pUrl = pendingUrl[item.kind];

              const badge = saved ? (
                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                  Feita
                </span>
              ) : pend ? (
                <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                  Pendente
                </span>
              ) : item.required ? (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                  Obrigatória
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                  Opcional
                </span>
              );

              return (
                <div
                  key={item.kind}
                  className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-gray-800">{item.label}</div>
                      {badge}
                    </div>

                    {item.help && <div className="mt-1 text-xs text-gray-500">{item.help}</div>}

                    {saved && savedUrl && (
                      <div className="mt-1">
                        <a
                          className="text-xs underline text-gray-600"
                          href={savedUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir arquivo
                        </a>
                      </div>
                    )}

                    {pend && (
                      <div className="mt-1 text-xs text-gray-600">
                        Selecionada: <b>{pendingFile[item.kind]?.name ?? "foto.jpg"}</b>
                        {pUrl && (
                          <>
                            {" "}
                            •{" "}
                            <button className="underline" onClick={() => setPreviewKind(item.kind)}>
                              Ver
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <label
                      className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                        disableAll ? "bg-gray-300" : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      📷 Tirar
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          onPick(item.kind, e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                        disabled={disableAll || busy}
                      />
                    </label>

                    <label
                      className={`cursor-pointer rounded-xl border px-4 py-2 text-sm ${
                        disableAll ? "opacity-50" : "hover:bg-gray-50"
                      }`}
                    >
                      🖼️ Galeria
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          onPick(item.kind, e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                        disabled={disableAll || busy}
                      />
                    </label>

                    {pend && (
                      <>
                        <button
                          className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                            disableAll ? "bg-gray-300" : "bg-green-600 hover:bg-green-700"
                          }`}
                          disabled={disableAll || busy}
                          onClick={() => uploadFoto(item.kind, pendingFile[item.kind] as File)}
                        >
                          {busy ? "Enviando..." : "Salvar ✅"}
                        </button>

                        <button
                          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                          disabled={disableAll || busy}
                          onClick={() => cancelPending(item.kind)}
                        >
                          Refazer
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            className={`rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400"
            }`}
            onClick={() => salvarRascunho()}
            disabled={disableAll || !dirty}
            title={dirty ? "Salvar alterações" : "Já está salvo"}
          >
            {saving ? "Salvando..." : dirty ? "Salvar rascunho" : "Rascunho salvo"}
          </button>

          <a className="rounded-xl border px-5 py-2 text-sm hover:bg-gray-50" href="/auditorias">
            Voltar
          </a>
        </div>
      </div>

      {previewKind && pendingUrl[previewKind] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                {FOTO_ITEMS.find((x) => x.kind === previewKind)?.label}
              </div>
              <button
                className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                onClick={() => setPreviewKind(null)}
              >
                Fechar
              </button>
            </div>
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingUrl[previewKind] as string}
                alt="preview"
                className="max-h-[70vh] w-full rounded-xl object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
