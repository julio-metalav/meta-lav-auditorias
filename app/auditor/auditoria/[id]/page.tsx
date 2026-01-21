"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type FotoKind = "agua" | "energia" | "gas" | "bombonas" | "conector_bala";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  observacoes?: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;
  foto_quimicos_url?: string | null;

  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  condominios?: { nome: string; cidade: string; uf: string } | null;
  profiles?: { id?: string; email?: string | null; role?: string | null } | null;
};

type Role = "auditor" | "interno" | "gestor" | null;

type MeState = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
};

type ProvetaRow = {
  maquina_id: string;
  maquina_tag: string;
  maquina_idx: number;
  foto_url: string;
};

type Lavadora = {
  maquina_id: string;
  maquina_idx: number;
  maquina_tag: string;
};

async function safeReadJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function roleRank(r: Role) {
  if (r === "auditor") return 1;
  if (r === "interno") return 2;
  if (r === "gestor") return 3;
  return 0;
}

export default function AuditorAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [aud, setAud] = useState<Aud | null>(null);
  const [me, setMe] = useState<MeState | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const okTimer = useRef<number | null>(null);

  const [agua_leitura, setAguaLeitura] = useState("");
  const [energia_leitura, setEnergiaLeitura] = useState("");
  const [gas_leitura, setGasLeitura] = useState("");
  const [obs, setObs] = useState("");
  const [dirty, setDirty] = useState(false);

  // 🔒 LAVADORAS REAIS (FONTE DA VERDADE)
  const [lavadoras, setLavadoras] = useState<Lavadora[]>([]);

  // PROVETAS
  const [provetas, setProvetas] = useState<ProvetaRow[]>([]);
  const provetasMap = useMemo(() => {
    const m = new Map<number, ProvetaRow>();
    for (const p of provetas) m.set(p.maquina_idx, p);
    return m;
  }, [provetas]);

  const [provUploading, setProvUploading] = useState<Record<number, boolean>>({});
  const [provPendingFile, setProvPendingFile] = useState<Record<number, File | null>>({});
  const [provPendingUrl, setProvPendingUrl] = useState<Record<number, string | null>>({});

  function setOkMsg(msg: string) {
    setOk(msg);
    if (okTimer.current) window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setOk(null), 2500);
  }

  const mismatch = useMemo(() => {
    if (!me?.id || !aud?.auditor_id) return false;
    if (roleRank(me.role) >= roleRank("interno")) return false;
    return me.id !== aud.auditor_id;
  }, [me, aud]);

  const concluida = useMemo(() => {
    const s = String(aud?.status ?? "").toLowerCase();
    return s === "em_conferencia" || s === "final";
  }, [aud?.status]);

  async function carregarLavadoras(condominioId: string) {
    const r = await fetch(`/api/condominios/${condominioId}/maquinas`, { cache: "no-store" });
    if (!r.ok) return setLavadoras([]);

    const j = await safeReadJson(r);
    const list: any[] = Array.isArray(j) ? j : j?.data ?? [];

    const lavs: Lavadora[] = list
      .filter((m) => String(m.maquina_tag).toLowerCase() === "lavadora")
      .map((m, idx) => ({
        maquina_id: m.id,
        maquina_idx: m.maquina_idx ?? idx + 1,
        maquina_tag: "lavadora",
      }))
      .sort((a, b) => a.maquina_idx - b.maquina_idx);

    setLavadoras(lavs);
  }

  async function carregarProvetas(auditoriaId: string) {
    const r = await fetch(`/api/auditorias/${auditoriaId}/provetas`, { cache: "no-store" });
    if (!r.ok) return setProvetas([]);

    const j = await safeReadJson(r);
    const list: any[] = Array.isArray(j) ? j : j?.data ?? [];

    setProvetas(
      list.map((p) => ({
        maquina_id: p.maquina_id,
        maquina_tag: p.maquina_tag,
        maquina_idx: p.maquina_idx,
        foto_url: p.foto_url,
      }))
    );
  }

  async function carregarTudo() {
    setLoading(true);
    setErr(null);

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeReadJson(meRes);

      setMe({
        id: meJson.user.id,
        email: meJson.user.email,
        name: meJson.user.name ?? null,
        role: meJson.role,
      });

      const res = await fetch(`/api/auditorias/${id}`, { cache: "no-store" });
      const json = await safeReadJson(res);
      const found = json?.auditoria as Aud;

      setAud(found);
      setAguaLeitura(found.agua_leitura?.toString() ?? "");
      setEnergiaLeitura(found.energia_leitura?.toString() ?? "");
      setGasLeitura(found.gas_leitura?.toString() ?? "");
      setObs(found.observacoes ?? "");
      setDirty(false);

      await carregarLavadoras(found.condominio_id);
      await carregarProvetas(found.id);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }
  async function uploadProveta(lav: Lavadora, file: File) {
    setErr(null);
    setOk(null);

    if (!aud) return setErr("Auditoria não carregada.");
    if (mismatch) return setErr("Você não é o auditor atribuído.");
    if (concluida) return setErr("Auditoria em conferência/final.");
    if (!file.type.startsWith("image/")) return setErr("Envie apenas imagem.");

    setProvUploading((p) => ({ ...p, [lav.maquina_idx]: true }));
    try {
      const fd = new FormData();
      fd.append("kind", "proveta");
      fd.append("maquina_id", lav.maquina_id);
      fd.append("maquina_tag", lav.maquina_tag);
      fd.append("maquina_idx", String(lav.maquina_idx));
      fd.append("file", file);

      const res = await fetch(`/api/auditorias/${id}/fotos`, {
        method: "POST",
        body: fd,
      });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao enviar proveta");

      await carregarProvetas(id);

      const url = provPendingUrl[lav.maquina_idx];
      if (url) URL.revokeObjectURL(url);

      setProvPendingFile((p) => ({ ...p, [lav.maquina_idx]: null }));
      setProvPendingUrl((p) => ({ ...p, [lav.maquina_idx]: null }));

      setOkMsg("Proveta salva ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao enviar proveta");
    } finally {
      setProvUploading((p) => ({ ...p, [lav.maquina_idx]: false }));
    }
  }

  useEffect(() => {
    carregarTudo();
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
      Object.values(provPendingUrl).forEach((u) => u && URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <AppShell title="Auditoria (Campo)">
      <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        {err && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}
        {ok && (
          <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {ok}
          </div>
        )}

        {/* PROVETAS */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800">
                Provetas (por lavadora)
              </div>
              <div className="text-xs text-gray-500">
                1 foto por lavadora
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Lavadoras: <b>{lavadoras.length || 0}</b>
            </div>
          </div>

          <div className="divide-y rounded-xl border">
            {lavadoras.map((lav) => {
              const saved = provetasMap.get(lav.maquina_idx);
              const pend = provPendingFile[lav.maquina_idx];
              const busy = provUploading[lav.maquina_idx];

              return (
                <div
                  key={lav.maquina_id}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">
                        Proveta Lavadora {lav.maquina_idx}
                      </div>
                      {saved ? (
                        <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                          Feita
                        </span>
                      ) : pend ? (
                        <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                          Pendente
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                          Obrigatória
                        </span>
                      )}
                    </div>

                    {saved && (
                      <div className="mt-1">
                        <a
                          href={saved.foto_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-gray-600"
                        >
                          Abrir arquivo
                        </a>
                      </div>
                    )}

                    {pend && (
                      <div className="mt-1 text-xs text-gray-600">
                        Selecionada: <b>{pend.name}</b>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label
                      className={`inline-flex cursor-pointer items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                        concluida || mismatch
                          ? "bg-gray-300"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      Tirar
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={concluida || mismatch || busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setProvPendingFile((p) => ({
                            ...p,
                            [lav.maquina_idx]: f,
                          }));
                          setProvPendingUrl((p) => ({
                            ...p,
                            [lav.maquina_idx]: URL.createObjectURL(f),
                          }));
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>

                    {pend && (
                      <>
                        <button
                          className="inline-flex items-center justify-center rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            uploadProveta(lav, pend as File)
                          }
                        >
                          {busy ? "Enviando..." : "Salvar"}
                        </button>

                        <button
                          className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                          onClick={() => {
                            const url =
                              provPendingUrl[lav.maquina_idx];
                            if (url) URL.revokeObjectURL(url);
                            setProvPendingFile((p) => ({
                              ...p,
                              [lav.maquina_idx]: null,
                            }));
                            setProvPendingUrl((p) => ({
                              ...p,
                              [lav.maquina_idx]: null,
                            }));
                          }}
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
      </div>
    </AppShell>
  );
}
