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

  // quando /api/auditorias traz join de profiles
  profiles?: { id?: string; email?: string | null; role?: string | null } | null;
};

type Me = { id: string; email: string | null; name: string | null };
type UserRow = { id: string; email: string | null };

type Role = "auditor" | "interno" | "gestor" | null;

type HistItem = {
  de_status: string | null;
  para_status: string | null;
  created_at: string;
  actor?: { id: string; email: string | null; role: string | null } | null;
};

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

async function safeReadJson(res: Response): Promise<any> {
  // evita "Unexpected end of JSON input" quando o backend responde vazio
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text().catch(() => "");
  if (!text) return {};

  if (!ct.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function fmtBR(dt: string) {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("pt-BR");
}

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

  // ✅ Histórico de status (somente leitura para interno/gestor)
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [histRole, setHistRole] = useState<Role>(null);
  const [histData, setHistData] = useState<HistItem[]>([]);

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
    // 1) tenta via /api/users (se tiver permissão)
    if (aud?.auditor_id) {
      const fromUsers = userEmailById.get(aud.auditor_id);
      if (fromUsers) return fromUsers;
    }
    // 2) fallback via join de profiles vindo de /api/auditorias
    const fromJoin = aud?.profiles?.email;
    if (fromJoin) return fromJoin;

    // 3) fallback final: UUID
    return aud?.auditor_id ?? "—";
  }, [aud?.auditor_id, aud?.profiles?.email, userEmailById]);

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

  const concluida = useMemo(() => {
    const s = String(aud?.status ?? "").trim().toLowerCase();
    return s === "em_conferencia" || s === "final";
  }, [aud?.status]);

  const canSeeHistorico = useMemo(() => {
    return histRole === "interno" || histRole === "gestor";
  }, [histRole]);

  async function carregarHistorico() {
    setHistLoading(true);
    setHistErr(null);

    try {
      const res = await fetch(`/api/auditorias/${id}/historico`, { cache: "no-store" });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar histórico");

      setHistRole((json?.role ?? null) as Role);
      setHistData(Array.isArray(json?.data) ? (json.data as HistItem[]) : []);
    } catch (e: any) {
      setHistErr(e?.message ?? "Falha ao carregar histórico");
      // não zera role/dados à força — evita flicker
    } finally {
      setHistLoading(false);
    }
  }

  async function carregarTudo() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      // 1) quem está logado
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeReadJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário logado");
      setMe(meJson);

      // 2) lista de users (pra traduzir auditor_id -> email)
      //    OBS: pode dar 403 para auditor. Sem estresse: usamos fallback do join "profiles".
      try {
        const uRes = await fetch("/api/users", { cache: "no-store" });
        const uJson = await safeReadJson(uRes);
        if (uRes.ok) setUsers(Array.isArray(uJson) ? uJson : uJson?.data ?? []);
      } catch {
        // ignora
      }

      // 3) auditoria (lista)
      const res = await fetch("/api/auditorias", { cache: "no-store" });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditorias");

      const list: Aud[] = Array.isArray(json) ? json : json?.data ?? [];
      const found = list.find((x) => x.id === id);
      if (!found) throw new Error("Auditoria não encontrada.");

      setAud(found);
      applyFromAud(found);

      // 4) histórico (independente — só mostra se role for interno/gestor)
      carregarHistorico();
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
    if (mismatch) return setErr(`Sem permissão: você está logado como "${meLabel}", mas esta auditoria é de "${assignedAuditorLabel}".`);
    if (concluida) return setErr("Esta auditoria já está em conferência. Não dá pra alterar em campo.");

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

      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao salvar");

      const saved: Aud | null = json?.auditoria ?? null;
      if (saved) {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));
        applyFromAud(saved);
      } else {
        setDirty(false);
      }

      setOkMsg(extra?.status ? "Concluída em campo ✅" : "Salvo ✓");

      // se mudou status, atualiza histórico
      if (extra?.status) carregarHistorico();
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
    if (mismatch) return setErr(`Sem permissão: você está logado como "${meLabel}", mas esta auditoria é de "${assignedAuditorLabel}".`);
    if (concluida) return setErr("Esta auditoria já está em conferência. Não dá pra alterar fotos em campo.");

    if (!file.type.startsWith("image/")) return setErr("Envie apenas imagem.");

    setUploading((p) => ({ ...p, [kind]: true }));
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);

      const res = await fetch(`/api/auditorias/${id}/fotos`, { method: "POST", body: fd });
      const json = await safeReadJson(res);

      if (!res.ok) {
        const raw = json?._raw ? ` (${String(json._raw).slice(0, 140)})` : "";
        throw new Error((json?.error ?? "Erro ao enviar foto") + raw);
      }

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

    const fotosObrigatoriasOk = fotoAguaOk && fotoEnergiaOk && fotoQuimicosOk && fotoBombonasOk && fotoConectorOk;
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

  const disableAll = loading || saving || !aud || mismatch || concluida;

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
          <b>Atenção:</b> você está logado como <b>{meLabel}</b>, mas esta auditoria pertence a <b>{assignedAuditorLabel}</b>.
          <div className="mt-1 text-xs text-red-700">Para lançar dados em campo, faça login com o usuário correto (o auditor atribuído).</div>
        </div>
      )}

      {concluida && !mismatch && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          ✅ Esta auditoria já foi concluída em campo e está <b>em conferência</b>.
        </div>
      )}

      {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {ok && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>}

      {/* ✅ Histórico de status (somente interno/gestor) */}
      {canSeeHistorico && (
        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Histórico de status</div>
              <div className="mt-1 text-xs text-gray-500">Somente leitura.</div>
            </div>

            <button
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={carregarHistorico}
              disabled={histLoading}
              title="Atualizar histórico"
            >
              {histLoading ? "Carregando..." : "Atualizar"}
            </button>
          </div>

          {histErr && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{histErr}</div>}

          {!histErr && !histLoading && histData.length === 0 && (
            <div className="mt-3 text-sm text-gray-600">Ainda não há registros de mudança de status.</div>
          )}

          {histData.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border">
              <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                <div className="col-span-4">Data/Hora</div>
                <div className="col-span-4">Status</div>
                <div className="col-span-4">Quem</div>
              </div>

              <div className="divide-y">
                {histData.map((h, idx) => {
                  const de = (h.de_status ?? "—").toString();
                  const para = (h.para_status ?? "—").toString();
                  const who = h.actor?.email ?? h.actor?.id ?? "—";
                  const whoRole = h.actor?.role ? ` • ${h.actor.role}` : "";
                  return (
                    <div key={`${h.created_at}-${idx}`} className="grid grid-cols-12 px-3 py-2 text-sm">
                      <div className="col-span-4 text-gray-700">{fmtBR(h.created_at)}</div>
                      <div className="col-span-4 text-gray-800">
                        <span className="font-mono text-xs text-gray-600">{de}</span> →{" "}
                        <span className="font-mono text-xs text-gray-600">{para}</span>
                      </div>
                      <div className="col-span-4 text-gray-700">
                        {who}
                        <span className="text-xs text-gray-500">{whoRole}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Conferência (campo)</div>
            {concluida ? (
              <div className="mt-1 text-sm font-semibold text-green-700"✔️ Já concluída</div>
            ) : checklist.prontoCampo ? (
              <div className="mt-1 text-sm font-semibold text-green-700">✅ Campo pronto</div>
            ) : (
              <div className="mt-1 text-sm text-red-700">
                Faltando: <b>{checklist.faltas.join(", ")}</b>
              </div>
            )}
            <div className="mt-1 text-xs text-gray-500">Gás é opcional.</div>
          </div>

          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              concluida ? "bg-green-300" : "bg-green-600 hover:bg-green-700"
            }`}
            disabled={concluida || !checklist.prontoCampo || loading || saving || !aud || mismatch}
            onClick={() => salvarRascunho({ status: "em_conferencia" })}
          >
            {saving ? "Salvando..." : concluida ? "Concluída ✓" : "Concluir em campo ✅"}
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
          <div className="text-xs text-gray-500">Tocar em “📷 Tirar” → depois “Salvar ✅”.</div>

          <div className="mt-3 divide-y rounded-xl border">
            {FOTO_ITEMS.map((item) => {
              const savedUrl = fotoUrl(aud, item.kind);
              const saved = !!savedUrl;
              const pend = !!pendingFile[item.kind];
              const busy = uploading[item.kind];
              const pUrl = pendingUrl[item.kind];

              const badge = saved ? (
                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">Feita</span>
              ) : pend ? (
                <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">Pendente</span>
              ) : item.required ? (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Obrigatória</span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Opcional</span>
              );

              return (
                <div key={item.kind} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-gray-800">{item.label}</div>
                      {badge}
                    </div>

                    {item.help && <div className="mt-1 text-xs text-gray-500">{item.help}</div>}

                    {saved && savedUrl && (
                      <div className="mt-1">
                        <a className="text-xs underline text-gray-600" href={savedUrl} target="_blank" rel="noreferrer">
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

                    <label className={`cursor-pointer rounded-xl border px-4 py-2 text-sm ${disableAll ? "opacity-50" : "hover:bg-gray-50"}`}>
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
              dirty ? "bg-gray-400 hover:bg-gray-500" : "bg-green-600"
            }`}
            onClick={() => salvarRascunho()}
            disabled={disableAll || !dirty}
            title={dirty ? "Salvar alterações" : "Já está salvo"}
          >
            {saving ? "Salvando..." : dirty ? "Salvar" : "Salvo ✓"}
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
              <div className="text-sm font-semibold">{FOTO_ITEMS.find((x) => x.kind === previewKind)?.label}</div>
              <button className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50" onClick={() => setPreviewKind(null)}>
                Fechar
              </button>
            </div>
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingUrl[previewKind] as string} alt="preview" className="max-h-[70vh] w-full rounded-xl object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
