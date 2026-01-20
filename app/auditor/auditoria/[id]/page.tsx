"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref: string | null;
  status: string | null;

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  base_agua?: number | null;
  base_energia?: number | null;
  base_gas?: number | null;

  observacoes?: string | null;

  // Fotos (legado + existentes)
  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;

  // legado: foto única de químicos
  foto_quimicos_url?: string | null;

  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  condominios?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;
  condominio?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;
};

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos" // legado (foto única)
  | "bombonas"
  | "conector_bala";

type FotoItem = {
  kind: FotoKind;
  label: string;
  required: boolean;
};

type ProvetasRow = {
  maquina_tag: string; // ex: "lavadora"
  maquina_idx: number; // 1..N
  foto_url: string;
};

function safeText(v: any) {
  return String(v ?? "");
}
function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isLavadoraLike(x: any) {
  const s = safeText(x).toLowerCase();
  return s.includes("lav") || s.includes("washer") || s.includes("lavadora");
}

export default function Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const auditoriaId = params?.id;

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);

  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  // Provetas (novo)
  const [numLavadoras, setNumLavadoras] = useState<number>(1);
  const [provetas, setProvetas] = useState<ProvetasRow[]>([]);
  const provetasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of provetas) {
      const key = `${safeText(p.maquina_tag || "lavadora")}:${safeNum(p.maquina_idx)}`;
      m.set(key, safeText(p.foto_url));
    }
    return m;
  }, [provetas]);

  // Itens antigos (checklist de fotos) — REMOVIDO "quimicos" daqui (agora é por lavadora)
  const FOTO_ITEMS: FotoItem[] = useMemo(
    () => [
      { kind: "agua", label: "Água (hidrômetro)", required: true },
      { kind: "energia", label: "Energia (medidor)", required: true },
      { kind: "gas", label: "Gás (medidor)", required: false },
      { kind: "bombonas", label: "Bombonas (químicos)", required: true },
      { kind: "conector_bala", label: "Conector bala", required: true },
    ],
    []
  );

  function getFotoUrlFromAud(kind: FotoKind, a: Aud | null) {
    if (!a) return null;
    switch (kind) {
      case "agua":
        return a.foto_agua_url ?? null;
      case "energia":
        return a.foto_energia_url ?? null;
      case "gas":
        return a.foto_gas_url ?? null;
      case "quimicos":
        return a.foto_quimicos_url ?? null;
      case "bombonas":
        return a.foto_bombonas_url ?? null;
      case "conector_bala":
        return a.foto_conector_bala_url ?? null;
      default:
        return null;
    }
  }

  async function apiGet<T = any>(url: string): Promise<T> {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`GET ${url} falhou (${r.status}): ${text}`);
    }
    return (await r.json()) as T;
  }

  async function apiPostForm<T = any>(url: string, fd: FormData): Promise<T> {
    const r = await fetch(url, { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(safeText((data as any)?.error || `POST ${url} falhou (${r.status})`));
    }
    return data as T;
  }

  async function loadAll() {
    setLoading(true);
    try {
      const meData = await apiGet<Me>("/api/me");
      setMe(meData);

      const a = await apiGet<Aud>(`/api/auditorias/${auditoriaId}`);
      setAud(a);

      // 1) Descobrir número de lavadoras via /api/condominios/[id]/maquinas (defensivo)
      let lavs = 1;

      try {
        const condoId = a.condominio_id;
        // endpoint existente (conforme seu contexto)
        const maquinasResp = await fetch(`/api/condominios/${condoId}/maquinas`, { method: "GET" });

        if (maquinasResp.ok) {
          const maquinasJson: any = await maquinasResp.json().catch(() => null);

          // formatos possíveis: { items: [...] } ou [...] direto
          const items: any[] = Array.isArray(maquinasJson)
            ? maquinasJson
            : Array.isArray(maquinasJson?.items)
            ? maquinasJson.items
            : Array.isArray(maquinasJson?.data)
            ? maquinasJson.data
            : [];

          // somar "quantidade" apenas de lavadoras
          const totalLavadoras = items.reduce((acc, it) => {
            // candidatos de campos: categoria, tipo, nome, tag
            const categoria = it?.categoria ?? it?.tipo ?? it?.nome ?? it?.tag ?? "";
            const qtd = it?.quantidade ?? it?.qtd ?? it?.qty ?? 0;
            if (isLavadoraLike(categoria)) return acc + safeNum(qtd || 0);
            return acc;
          }, 0);

          if (totalLavadoras > 0) lavs = totalLavadoras;
        }
      } catch {
        // silêncio: fallback fica em 1
      }

      setNumLavadoras(lavs > 0 ? lavs : 1);

      // 2) Carregar provetas já salvas (endpoint preferido)
      try {
        const provResp = await fetch(`/api/auditorias/${auditoriaId}/provetas`, { method: "GET" });
        if (provResp.ok) {
          const provJson: any = await provResp.json().catch(() => []);
          const list: ProvetasRow[] = Array.isArray(provJson) ? provJson : Array.isArray(provJson?.items) ? provJson.items : [];
          setProvetas(
            list
              .map((x) => ({
                maquina_tag: safeText(x?.maquina_tag || "lavadora"),
                maquina_idx: safeNum(x?.maquina_idx || 0),
                foto_url: safeText(x?.foto_url || ""),
              }))
              .filter((x) => x.maquina_idx >= 1 && x.foto_url)
          );
        } else {
          // se ainda não existe endpoint, não quebra nada
          setProvetas([]);
        }
      } catch {
        setProvetas([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!auditoriaId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditoriaId]);

  async function onUploadFoto(kind: FotoKind, file: File) {
    if (!auditoriaId) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);

    await apiPostForm(`/api/auditorias/${auditoriaId}/fotos`, fd);
    await loadAll();
  }

  async function onUploadProveta(idx: number, file: File) {
    if (!auditoriaId) return;
    const fd = new FormData();
    fd.append("kind", "proveta");
    fd.append("maquina_idx", String(idx));
    fd.append("maquina_tag", "lavadora");
    fd.append("file", file);

    await apiPostForm(`/api/auditorias/${auditoriaId}/fotos`, fd);

    // Recarrega provetas; se endpoint ainda não existir, pelo menos não quebra
    await loadAll();
  }

  // Checklist OK?
  const checklistFotosOk = useMemo(() => {
    if (!aud) return false;
    return FOTO_ITEMS.every((it) => {
      const url = getFotoUrlFromAud(it.kind, aud);
      if (!it.required) return true;
      return !!url;
    });
  }, [aud, FOTO_ITEMS]);

  const checklistProvetasOk = useMemo(() => {
    const n = numLavadoras > 0 ? numLavadoras : 1;
    for (let i = 1; i <= n; i++) {
      const key = `lavadora:${i}`;
      const url = provetasMap.get(key);
      if (!url) return false;
    }
    return true;
  }, [numLavadoras, provetasMap]);

  // Exibir “legado quimicos” (sem exigir) — só pra não “sumir” caso exista
  const legadoQuimicosUrl = aud?.foto_quimicos_url ?? null;

  async function saveDraft() {
    if (!auditoriaId) return;
    setSavingDraft(true);
    try {
      const r = await fetch(`/api/auditorias/${auditoriaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agua_leitura: aud?.agua_leitura ?? null,
          energia_leitura: aud?.energia_leitura ?? null,
          gas_leitura: aud?.gas_leitura ?? null,
          observacoes: aud?.observacoes ?? null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(safeText((data as any)?.error || "Falha ao salvar rascunho"));
      setDraftSavedAt(new Date().toLocaleString("pt-BR"));
    } finally {
      setSavingDraft(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-4">Carregando…</div>
      </AppShell>
    );
  }

  if (!me?.user) {
    return (
      <AppShell>
        <div className="p-4">Você não está autenticado.</div>
      </AppShell>
    );
  }

  if (!aud) {
    return (
      <AppShell>
        <div className="p-4">Auditoria não encontrada.</div>
      </AppShell>
    );
  }

  const condoNome =
    aud?.condominios?.nome ||
    aud?.condominio?.nome ||
    "(Condomínio sem nome)";

  return (
    <AppShell>
      <div className="p-4 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Auditoria (Campo)</h1>
            <div className="text-sm text-neutral-600">
              <div>
                <span className="font-medium">Condomínio:</span> {condoNome}
              </div>
              <div>
                <span className="font-medium">Mês ref.:</span> {aud.mes_ref || "—"}
              </div>
              <div>
                <span className="font-medium">Status:</span> {aud.status || "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={() => router.back()}
              className="px-3 py-2 rounded-md border hover:bg-neutral-50"
              type="button"
            >
              Voltar
            </button>

            <button
              onClick={saveDraft}
              disabled={savingDraft}
              className="px-3 py-2 rounded-md bg-black text-white hover:opacity-90 disabled:opacity-50"
              type="button"
            >
              {savingDraft ? "Salvando…" : "Salvar rascunho"}
            </button>
            {draftSavedAt ? (
              <div className="text-xs text-neutral-600">Rascunho salvo em: {draftSavedAt}</div>
            ) : null}
          </div>
        </div>

        {/* Leituras */}
        <section className="rounded-xl border p-4 space-y-4">
          <h2 className="font-semibold">Leituras</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <div className="text-sm font-medium">Água</div>
              <input
                value={aud.agua_leitura ?? ""}
                onChange={(e) => setAud({ ...aud, agua_leitura: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-md"
                inputMode="decimal"
                placeholder="Ex: 1234"
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm font-medium">Energia</div>
              <input
                value={aud.energia_leitura ?? ""}
                onChange={(e) => setAud({ ...aud, energia_leitura: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-md"
                inputMode="decimal"
                placeholder="Ex: 5678"
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm font-medium">Gás (opcional)</div>
              <input
                value={aud.gas_leitura ?? ""}
                onChange={(e) => setAud({ ...aud, gas_leitura: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-md"
                inputMode="decimal"
                placeholder="Ex: 90"
              />
            </label>
          </div>

          <label className="space-y-1 block">
            <div className="text-sm font-medium">Observações</div>
            <textarea
              value={aud.observacoes ?? ""}
              onChange={(e) => setAud({ ...aud, observacoes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md min-h-[96px]"
              placeholder="Anote detalhes do campo…"
            />
          </label>
        </section>

        {/* Fotos (itens antigos do checklist) */}
        <section className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Checklist de fotos</h2>
            <div className="text-sm">
              <span className="font-medium">Status:</span>{" "}
              {checklistFotosOk ? (
                <span className="text-green-700">OK</span>
              ) : (
                <span className="text-red-700">Pendente</span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {FOTO_ITEMS.map((it) => {
              const url = getFotoUrlFromAud(it.kind, aud);
              const done = !!url || !it.required;

              return (
                <div
                  key={it.kind}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-lg border p-3"
                >
                  <div className="flex-1">
                    <div className="font-medium">
                      {it.label}{" "}
                      {it.required ? <span className="text-red-700">*</span> : <span className="text-neutral-500">(opcional)</span>}
                    </div>
                    <div className="text-sm text-neutral-600">
                      Status:{" "}
                      {done ? (
                        <span className="text-green-700">Feita</span>
                      ) : (
                        <span className="text-red-700">Pendente</span>
                      )}
                      {url ? (
                        <>
                          {" "}
                          •{" "}
                          <a className="underline" href={url} target="_blank" rel="noreferrer">
                            Abrir arquivo
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        onUploadFoto(it.kind, f).catch((err) => alert(err?.message || String(err)));
                        e.currentTarget.value = "";
                      }}
                      className="text-sm"
                    />
                  </div>
                </div>
              );
            })}

            {/* Legado: foto única de químicos (não é mais obrigatória / não faz parte do checklist) */}
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-lg border p-3 bg-neutral-50">
              <div className="flex-1">
                <div className="font-medium">
                  Proveta (legado: foto única de químicos) <span className="text-neutral-500">(não obrigatório)</span>
                </div>
                <div className="text-sm text-neutral-600">
                  Status:{" "}
                  {legadoQuimicosUrl ? (
                    <span className="text-green-700">Existe</span>
                  ) : (
                    <span className="text-neutral-600">Não enviada</span>
                  )}
                  {legadoQuimicosUrl ? (
                    <>
                      {" "}
                      •{" "}
                      <a className="underline" href={legadoQuimicosUrl} target="_blank" rel="noreferrer">
                        Abrir arquivo
                      </a>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    // mantém compatibilidade com o backend legado
                    onUploadFoto("quimicos", f).catch((err) => alert(err?.message || String(err)));
                    e.currentTarget.value = "";
                  }}
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          <div className="text-xs text-neutral-600">
            * obrigatório = precisa estar “Feita” para o checklist ficar OK.
          </div>
        </section>

        {/* Provetas por lavadora (novo) */}
        <section className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Provetas (por lavadora)</h2>
              <div className="text-sm text-neutral-600">
                Precisamos de <span className="font-medium">{numLavadoras || 1}</span> foto(s) — 1 por lavadora.
              </div>
            </div>

            <div className="text-sm">
              <span className="font-medium">Status:</span>{" "}
              {checklistProvetasOk ? (
                <span className="text-green-700">OK</span>
              ) : (
                <span className="text-red-700">Pendente</span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {Array.from({ length: numLavadoras > 0 ? numLavadoras : 1 }).map((_, i) => {
              const idx = i + 1;
              const key = `lavadora:${idx}`;
              const url = provetasMap.get(key) || "";

              return (
                <div key={key} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-lg border p-3">
                  <div className="flex-1">
                    <div className="font-medium">
                      Proveta Lavadora {idx} <span className="text-red-700">*</span>
                    </div>
                    <div className="text-sm text-neutral-600">
                      Status:{" "}
                      {url ? <span className="text-green-700">Feita</span> : <span className="text-red-700">Pendente</span>}
                      {url ? (
                        <>
                          {" "}
                          •{" "}
                          <a className="underline" href={url} target="_blank" rel="noreferrer">
                            Abrir arquivo
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        onUploadProveta(idx, f).catch((err) => alert(err?.message || String(err)));
                        e.currentTarget.value = "";
                      }}
                      className="text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-neutral-600">
            * obrigatório = todas as lavadoras precisam ter proveta enviada.
          </div>
        </section>

        {/* Resumo geral */}
        <section className="rounded-xl border p-4">
          <h2 className="font-semibold mb-2">Resumo</h2>
          <div className="text-sm text-neutral-700 space-y-1">
            <div>
              Fotos (itens gerais):{" "}
              {checklistFotosOk ? <span className="text-green-700 font-medium">OK</span> : <span className="text-red-700 font-medium">Pendente</span>}
            </div>
            <div>
              Provetas (lavadoras):{" "}
              {checklistProvetasOk ? <span className="text-green-700 font-medium">OK</span> : <span className="text-red-700 font-medium">Pendente</span>}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
