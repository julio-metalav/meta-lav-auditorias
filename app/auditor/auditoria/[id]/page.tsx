"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

type FotoKind = "agua" | "energia" | "gas" | "quimicos" | "bombonas" | "conector_bala";

type Aud = {
  id: string;
  condominio_id: string;
  auditor_id: string | null;
  ano_mes?: string | null;
  mes_ref?: string | null;
  status: string | null;

  // schema NOVO (real)
  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  observacoes?: string | null;

  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;

  // extras (podem existir no banco ou não; UI suporta)
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

type UserRow = { id: string; email: string | null };

type HistItem = {
  de_status: string | null;
  para_status: string | null;
  created_at: string;
  actor?: { id: string; email: string | null; role: string | null } | null;
};

type FotoItem = { kind: FotoKind; label: string; required: boolean; help?: string };

const FOTO_ITEMS: FotoItem[] = [
  { kind: "agua", label: "Medidor de Água", required: true },
  { kind: "energia", label: "Medidor de Energia", required: true },
  { kind: "gas", label: "Medidor de Gás", required: false, help: "Opcional (se houver gás)" },
  { kind: "quimicos", label: "Proveta (aferição de químicos)", required: true },
  { kind: "bombonas", label: "Bombonas (detergente + amaciante)", required: true, help: "Uma foto com as duas bombonas" },
  { kind: "conector_bala", label: "Conector bala conectado", required: true },
];

type ProvetaRow = { maquina_tag: string; maquina_idx: number; foto_url: string };

async function safeReadJson(res: Response): Promise<any> {
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

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

function toNumberOrNull(v: string): number | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toText(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function roleRank(r: Role) {
  if (r === "auditor") return 1;
  if (r === "interno") return 2;
  if (r === "gestor") return 3;
  return 0;
}

function normStatus(s: any) {
  const x = String(s ?? "").trim().toLowerCase();
  if (x === "em conferencia") return "em_conferencia";
  return x;
}

function statusBadge(s: any) {
  const x = normStatus(s);
  if (x === "aberta") return { label: "Aberta", cls: "bg-gray-100 text-gray-800" };
  if (x === "em_andamento") return { label: "Em andamento", cls: "bg-blue-100 text-blue-800" };
  if (x === "em_conferencia") return { label: "Em conferência", cls: "bg-yellow-100 text-yellow-900" };
  if (x === "final") return { label: "Final", cls: "bg-green-100 text-green-800" };
  return { label: String(s ?? "-"), cls: "bg-gray-100 text-gray-800" };
}

function rolePill(r: Role) {
  if (r === "auditor") return { label: "Auditor", cls: "bg-blue-100 text-blue-800 border-blue-200" };
  if (r === "interno") return { label: "Interno", cls: "bg-orange-100 text-orange-900 border-orange-200" };
  if (r === "gestor") return { label: "Gestor", cls: "bg-green-100 text-green-800 border-green-200" };
  return { label: "—", cls: "bg-gray-100 text-gray-700 border-gray-200" };
}

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

export default function AuditorAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [aud, setAud] = useState<Aud | null>(null);
  const [me, setMe] = useState<MeState | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const okTimer = useRef<number | null>(null);

  const [obs, setObs] = useState("");
  const [agua_leitura, setAguaLeitura] = useState("");
  const [energia_leitura, setEnergiaLeitura] = useState("");
  const [gas_leitura, setGasLeitura] = useState("");

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

  // ✅ Provetas por lavadora (novo) - sem mexer no checklist/Concluir por enquanto
  const [numLavadoras, setNumLavadoras] = useState<number>(1);
  const [provetas, setProvetas] = useState<ProvetaRow[]>([]);
  const provetasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of provetas) {
      const key = `${safeText(p.maquina_tag || "lavadora")}:${safeNum(p.maquina_idx)}`;
      m.set(key, safeText(p.foto_url));
    }
    return m;
  }, [provetas]);

  const [provetaUploading, setProvetaUploading] = useState<Record<number, boolean>>({});
  const [provetaPendingFile, setProvetaPendingFile] = useState<Record<number, File | undefined>>({});
  const [provetaPendingUrl, setProvetaPendingUrl] = useState<Record<number, string | undefined>>({});
  const [previewProvetaIdx, setPreviewProvetaIdx] = useState<number | null>(null);

  // Histórico (somente leitura para interno/gestor)
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

    const aAg = a.agua_leitura ?? null;
    const aEn = a.energia_leitura ?? null;
    const aGs = a.gas_leitura ?? null;

    if (aAg !== null && aAg !== undefined) setAguaLeitura(toText(aAg));
    else setAguaLeitura("");

    if (aEn !== null && aEn !== undefined) setEnergiaLeitura(toText(aEn));
    else setEnergiaLeitura("");

    if (aGs !== null && aGs !== undefined) setGasLeitura(toText(aGs));
    else setGasLeitura("");

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
    if (aud?.auditor_id) {
      const fromUsers = userEmailById.get(aud.auditor_id);
      if (fromUsers) return fromUsers;
    }
    const fromJoin = aud?.profiles?.email;
    if (fromJoin) return fromJoin;
    return aud?.auditor_id ?? "-";
  }, [aud?.auditor_id, aud?.profiles?.email, userEmailById]);

  const meLabel = useMemo(() => {
    if (!me) return "-";
    const base = me.name ? `${me.name} (${me.email ?? me.id})` : me.email ?? me.id;
    return me.role ? `${base} - perfil: ${me.role}` : base;
  }, [me]);

  const isAuditor = useMemo(() => me?.role === "auditor", [me?.role]);

  // ✅ regra: interno/gestor NÃO bloqueia por mismatch
  const mismatch = useMemo(() => {
    if (!me?.id) return false;
    if (!aud?.auditor_id) return false;
    if (roleRank(me.role) >= roleRank("interno")) return false;
    return me.id !== aud.auditor_id;
  }, [me?.id, me?.role, aud?.auditor_id]);

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
    } finally {
      setHistLoading(false);
    }
  }

  async function carregarNumLavadoras(condoId: string) {
    // defensivo: se endpoint não existir ou formato variar, não quebra
    try {
      const resp = await fetch(`/api/condominios/${condoId}/maquinas`, { method: "GET", cache: "no-store" });
      if (!resp.ok) return 1;

      const json = await safeReadJson(resp);
      const items: any[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.data)
        ? json.data
        : [];

      const totalLavadoras = items.reduce((acc, it) => {
        const categoria = it?.categoria ?? it?.tipo ?? it?.nome ?? it?.tag ?? "";
        const qtd = it?.quantidade ?? it?.qtd ?? it?.qty ?? 0;
        if (isLavadoraLike(categoria)) return acc + safeNum(qtd || 0);
        return acc;
      }, 0);

      return totalLavadoras > 0 ? totalLavadoras : 1;
    } catch {
      return 1;
    }
  }

  async function carregarProvetas(auditoriaId: string) {
    // defensivo: se endpoint não existir ainda, não quebra a tela
    try {
      const resp = await fetch(`/api/auditorias/${auditoriaId}/provetas`, { method: "GET", cache: "no-store" });
      if (!resp.ok) {
        setProvetas([]);
        return;
      }
      const json = await safeReadJson(resp);
      const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
      const parsed: ProvetaRow[] = list
        .map((x) => ({
          maquina_tag: safeText(x?.maquina_tag || "lavadora"),
          maquina_idx: safeNum(x?.maquina_idx || 0),
          foto_url: safeText(x?.foto_url || ""),
        }))
        .filter((x) => x.maquina_idx >= 1 && !!x.foto_url);
      setProvetas(parsed);
    } catch {
      setProvetas([]);
    }
  }

  async function carregarTudo() {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meJson = await safeReadJson(meRes);
      if (!meRes.ok) throw new Error(meJson?.error ?? "Erro ao identificar usuário logado");

      const meObj = meJson?.user ? meJson.user : meJson;
      const roleObj = (meJson?.role ?? null) as Role;

      setMe({
        id: meObj?.id,
        email: meObj?.email ?? null,
        name: meObj?.name ?? null,
        role: roleObj,
      });

      try {
        const uRes = await fetch("/api/users", { cache: "no-store" });
        const uJson = await safeReadJson(uRes);
        if (uRes.ok) setUsers(Array.isArray(uJson) ? uJson : uJson?.data ?? []);
      } catch {
        // ignora
      }

      const res = await fetch(`/api/auditorias/${id}`, { cache: "no-store" });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditoria");

      const found: Aud | null = (json?.auditoria ?? null) as Aud | null;
      if (!found) throw new Error("Auditoria não encontrada.");

      setAud(found);
      applyFromAud(found);

      // ✅ Provetas por lavadora: carrega qty + provetas (sem quebrar nada se falhar)
      const lavs = await carregarNumLavadoras(found.condominio_id);
      setNumLavadoras(lavs > 0 ? lavs : 1);
      await carregarProvetas(id);

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
    if (mismatch) return setErr(`Sem permissão: logado como "${meLabel}", mas auditoria é de "${assignedAuditorLabel}".`);
    if (concluida) return setErr("Esta auditoria já está em conferência/final. Não dá pra alterar em campo.");

    setSaving(true);
    try {
      const res = await fetch(`/api/auditorias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agua_leitura: toNumberOrNull(agua_leitura),
          energia_leitura: toNumberOrNull(energia_leitura),
          gas_leitura: toNumberOrNull(gas_leitura),
          observacoes: obs,
          ...(extra ?? {}),
        }),
      });

      const json = await safeReadJson(res);
      if (!res.ok) {
        if (Array.isArray(json?.missing) && json.missing.length) {
          throw new Error(`${json?.error ?? "Checklist incompleto"}: ${json.missing.join(", ")}`);
        }
        throw new Error(json?.error ?? "Erro ao salvar");
      }

      const saved: Aud | null = json?.auditoria ?? null;
      if (saved) {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...saved }));
        applyFromAud(saved);
      } else {
        setDirty(false);
      }

      setOkMsg(extra?.status ? "Concluída em campo ✅" : "Salvo ✅");

      if (extra?.status) {
        await carregarTudo();
      } else {
        carregarHistorico();
      }
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
    if (mismatch) return setErr(`Sem permissão: logado como "${meLabel}", mas auditoria é de "${assignedAuditorLabel}".`);
    if (concluida) return setErr("Esta auditoria já está em conferência/final. Não dá pra alterar fotos em campo.");
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

      const updated = (json?.updated ?? null) as Record<string, any> | null;
      if (updated && typeof updated === "object") {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...(updated as any) }));
      } else if (json?.auditoria) {
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), ...(json.auditoria as Aud) }));
      } else if (json?.url) {
        const map: Record<FotoKind, keyof Aud> = {
          agua: "foto_agua_url",
          energia: "foto_energia_url",
          gas: "foto_gas_url",
          quimicos: "foto_quimicos_url",
          bombonas: "foto_bombonas_url",
          conector_bala: "foto_conector_bala_url",
        };
        const key = map[kind];
        setAud((prev) => ({ ...(prev ?? ({} as Aud)), [key]: json.url } as any));
      }

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

  // ✅ Provetas (por lavadora)
  function onPickProveta(idx: number, file?: File | null) {
    if (!file) return;

    const url = URL.createObjectURL(file);
    const old = provetaPendingUrl[idx];
    if (old) URL.revokeObjectURL(old);

    setProvetaPendingFile((p) => ({ ...p, [idx]: file }));
    setProvetaPendingUrl((p) => ({ ...p, [idx]: url }));
    setPreviewProvetaIdx(null);
  }

  function cancelPendingProveta(idx: number) {
    const url = provetaPendingUrl[idx];
    if (url) URL.revokeObjectURL(url);

    setProvetaPendingFile((p) => {
      const copy = { ...p };
      delete copy[idx];
      return copy;
    });
    setProvetaPendingUrl((p) => {
      const copy = { ...p };
      delete copy[idx];
      return copy;
    });

    if (previewProvetaIdx === idx) setPreviewProvetaIdx(null);
  }

  async function uploadProveta(idx: number, file: File) {
    setErr(null);
    setOk(null);

    if (!aud) return setErr("Auditoria não carregada.");
    if (mismatch) return setErr(`Sem permissão: logado como "${meLabel}", mas auditoria é de "${assignedAuditorLabel}".`);
    if (concluida) return setErr("Esta auditoria já está em conferência/final. Não dá pra alterar fotos em campo.");
    if (!file.type.startsWith("image/")) return setErr("Envie apenas imagem.");

    setProvetaUploading((p) => ({ ...p, [idx]: true }));
    try {
      const fd = new FormData();
      fd.append("kind", "proveta");
      fd.append("maquina_tag", "lavadora");
      fd.append("maquina_idx", String(idx));
      fd.append("file", file);

      const res = await fetch(`/api/auditorias/${id}/fotos`, { method: "POST", body: fd });
      const json = await safeReadJson(res);

      if (!res.ok) {
        const raw = json?._raw ? ` (${String(json._raw).slice(0, 140)})` : "";
        throw new Error((json?.error ?? "Erro ao enviar proveta") + raw);
      }

      // limpa pendência
      const pUrl = provetaPendingUrl[idx];
      if (pUrl) URL.revokeObjectURL(pUrl);

      setProvetaPendingFile((p) => {
        const copy = { ...p };
        delete copy[idx];
        return copy;
      });
      setProvetaPendingUrl((p) => {
        const copy = { ...p };
        delete copy[idx];
        return copy;
      });
      if (previewProvetaIdx === idx) setPreviewProvetaIdx(null);

      // recarrega lista provetas (não quebra se endpoint falhar)
      await carregarProvetas(id);

      setOkMsg("Proveta salva ✅");
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao enviar proveta");
    } finally {
      setProvetaUploading((p) => ({ ...p, [idx]: false }));
    }
  }

  const checklistUi = useMemo(() => {
    const a = aud;

    const leituraAguaOk = (agua_leitura ?? "").trim().length > 0;
    const leituraEnergiaOk = (energia_leitura ?? "").trim().length > 0;

    const fotoAguaOk = !!a?.foto_agua_url;
    const fotoEnergiaOk = !!a?.foto_energia_url;
    const fotoQuimicosOk = !!a?.foto_quimicos_url;
    const fotoBombonasOk = !!a?.foto_bombonas_url;
    const fotoConectorOk = !!a?.foto_conector_bala_url;

    const items = [
      { label: "Leitura de água", ok: leituraAguaOk, required: true },
      { label: "Leitura de energia", ok: leituraEnergiaOk, required: true },
      { label: "Foto do medidor de água", ok: fotoAguaOk, required: true },
      { label: "Foto do medidor de energia", ok: fotoEnergiaOk, required: true },
      { label: "Foto proveta (químicos)", ok: fotoQuimicosOk, required: true },
      { label: "Foto bombonas", ok: fotoBombonasOk, required: true },
      { label: "Foto conector bala", ok: fotoConectorOk, required: true },
      { label: "Leitura de gás (opcional)", ok: (gas_leitura ?? "").trim().length > 0, required: false },
      { label: "Foto do medidor de gás (opcional)", ok: !!a?.foto_gas_url, required: false },
    ];

    const required = items.filter((i) => i.required);
    const doneReq = required.filter((i) => i.ok).length;
    const totalReq = required.length;

    const faltas = required.filter((i) => !i.ok).map((i) => i.label);
    const prontoCampo = faltas.length === 0;
    const pct = totalReq === 0 ? 0 : Math.round((doneReq / totalReq) * 100);

    return { items, faltas, prontoCampo, doneReq, totalReq, pct };
  }, [aud, agua_leitura, energia_leitura, gas_leitura]);

  const concluidaBanner = useMemo(() => statusBadge(aud?.status), [aud?.status]);
  const mePill = useMemo(() => rolePill(me?.role ?? null), [me?.role]);

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
      Object.values(pendingUrl).forEach((u) => u && URL.revokeObjectURL(u));
      Object.values(provetaPendingUrl).forEach((u) => u && URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titulo = aud?.condominios
    ? `${aud.condominios.nome} - ${aud.condominios.cidade}/${aud.condominios.uf}`
    : aud?.condominio_id ?? "";

  const disableAll = loading || saving || !aud || concluida;
  const busyAnyUpload = useMemo(() => Object.values(uploading).some(Boolean), [uploading]);
  const busyAnyProveta = useMemo(() => Object.values(provetaUploading).some(Boolean), [provetaUploading]);

  const concludeDisabledReason = useMemo(() => {
    if (!aud) return "Auditoria não carregada";
    if (loading || saving) return "Aguarde…";
    if (busyAnyUpload || busyAnyProveta) return "Ainda tem upload em andamento";
    if (mismatch) return "Você não é o auditor atribuído";
    if (concluida) return "Já está em conferência/final";
    if (!checklistUi.prontoCampo) return `Faltando: ${checklistUi.faltas.join(", ")}`;
    return "";
  }, [aud, loading, saving, busyAnyUpload, busyAnyProveta, mismatch, concluida, checklistUi]);

  async function concluirEmCampo() {
    const okConfirm = window.confirm(
      "Após concluir, você não poderá mais alterar leituras e fotos como auditor. Deseja continuar?"
    );
    if (!okConfirm) return;
    await salvarRascunho({ status: "em_conferencia" });
  }

  const provetasStatus = useMemo(() => {
    const n = numLavadoras > 0 ? numLavadoras : 1;
    let done = 0;
    for (let i = 1; i <= n; i++) {
      const key = `lavadora:${i}`;
      if (provetasMap.get(key)) done++;
    }
    const total = n;
    const okAll = total > 0 && done === total;
    return { done, total, okAll };
  }, [numLavadoras, provetasMap]);

  return (
    <AppShell title="Auditoria (Campo)">
      {/* ✅ container mobile-first, sem scroll horizontal */}
      <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6 overflow-x-hidden">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold sm:text-2xl">Auditoria (Campo)</h1>

              <span
                className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold ${mePill.cls}`}
              >
                {mePill.label}
              </span>

              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${concluidaBanner.cls}`}>
                {concluidaBanner.label}
              </span>
            </div>

            <div className="mt-1 text-sm text-gray-600 truncate">{titulo}</div>

            <div className="mt-2 rounded-xl border bg-white p-3 text-xs">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-gray-700 break-words">
                  <b>Logado como:</b> {meLabel}
                </div>
                <div className="text-gray-700 break-words">
                  <b>Auditoria atribuída a:</b> {assignedAuditorLabel}
                </div>
              </div>
            </div>

            <div className="mt-2 text-xs text-gray-500">
              Mês: <b>{aud ? pickMonth(aud) : "-"}</b> • ID:{" "}
              <span className="font-mono text-gray-400 break-all">{id}</span>
            </div>

            {/* ✅ UX: volta clara quando já concluiu */}
            {concluida && isAuditor && (
              <div className="mt-3">
                <a
                  className="inline-flex w-full items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50 sm:w-auto"
                  href="/auditorias"
                  title="Voltar para a lista das suas auditorias"
                >
                  ← Voltar para minhas auditorias
                </a>
              </div>
            )}
          </div>

          <button
            className="w-full shrink-0 rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
            onClick={carregarTudo}
            disabled={loading || saving}
            title="Recarregar dados"
          >
            {loading ? "Carregando..." : "Recarregar"}
          </button>
        </div>

        {/* Mensagens */}
        {mismatch && (
          <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <b>Atenção:</b> você está logado como <b>{meLabel}</b>, mas a auditoria pertence a{" "}
            <b>{assignedAuditorLabel}</b>.
            <div className="mt-1 text-xs text-red-700">
              Para lançar dados como auditor, faça login com o usuário do auditor atribuído.
            </div>
            <div className="mt-1 text-xs text-red-700">Obs: interno/gestor não são bloqueados por isso.</div>
          </div>
        )}

        {concluida && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Esta auditoria já foi concluída e está em <b>{concluidaBanner.label}</b>. (Somente leitura nesta tela)
          </div>
        )}

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
        )}
        {ok && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div>
        )}

        {/* Checklist + Progresso + Ação principal */}
        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800">Checklist de campo</div>
              <div className="mt-1 text-xs text-gray-500">
                Para concluir, complete os itens obrigatórios. (Gás é opcional — o sistema decide por condomínio)
              </div>

              {/* Progresso */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <div>
                    Progresso:{" "}
                    <b>
                      {checklistUi.doneReq}/{checklistUi.totalReq}
                    </b>
                  </div>
                  <div>
                    <b>{checklistUi.pct}%</b>
                  </div>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-green-500" style={{ width: `${checklistUi.pct}%` }} />
                </div>
              </div>

              {/* Lista */}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {checklistUi.items.map((it) => (
                  <div
                    key={it.label}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                      it.ok ? "bg-green-50 border-green-200" : it.required ? "bg-red-50 border-red-200" : "bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate">
                        {it.ok ? "✅ " : "⬜ "}
                        {it.label}
                      </div>
                      {!it.required && <div className="text-xs text-gray-500">Opcional</div>}
                    </div>
                    <div className="text-xs font-semibold">
                      {it.ok ? (
                        <span className="text-green-700">OK</span>
                      ) : it.required ? (
                        <span className="text-red-700">Falta</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!checklistUi.prontoCampo && !concluida && (
                <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                  Falta concluir: <b>{checklistUi.faltas.join(", ")}</b>
                </div>
              )}
            </div>

            <div className="shrink-0">
              <button
                className={`w-full rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto ${
                  concluida ? "bg-green-300" : checklistUi.prontoCampo ? "bg-green-600 hover:bg-green-700" : "bg-gray-400"
                }`}
                disabled={!!concludeDisabledReason}
                onClick={concluirEmCampo}
                title={concludeDisabledReason || "Concluir em campo"}
              >
                {saving ? "Salvando..." : concluida ? "Concluída" : "Concluir em campo"}
              </button>

              {!!concludeDisabledReason && !concluida && (
                <div className="mt-2 max-w-full text-xs text-gray-500 sm:max-w-[260px] break-words">
                  {concludeDisabledReason}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Histórico (somente leitura p/ interno/gestor) */}
        {canSeeHistorico && (
          <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Histórico de status</div>
                <div className="mt-1 text-xs text-gray-500">Somente leitura.</div>
              </div>

              <button
                className="w-full rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
                onClick={carregarHistorico}
                disabled={histLoading}
                title="Atualizar histórico"
              >
                {histLoading ? "Carregando..." : "Atualizar"}
              </button>
            </div>

            {histErr && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{histErr}</div>
            )}

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
                    const de = (h.de_status ?? "-").toString();
                    const para = (h.para_status ?? "-").toString();
                    const who = h.actor?.email ?? h.actor?.id ?? "-";
                    const whoRole = h.actor?.role ? ` - ${h.actor.role}` : "";
                    return (
                      <div key={`${h.created_at}-${idx}`} className="grid grid-cols-12 px-3 py-2 text-sm">
                        <div className="col-span-12 sm:col-span-4 text-gray-700">{fmtBR(h.created_at)}</div>
                        <div className="col-span-12 sm:col-span-4 text-gray-800">
                          <span className="font-mono text-xs text-gray-600">{de}</span> {"->"}{" "}
                          <span className="font-mono text-xs text-gray-600">{para}</span>
                        </div>
                        <div className="col-span-12 sm:col-span-4 text-gray-700">
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

        {/* Conteúdo: Leituras + Observações + Fotos */}
        <div className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-gray-700">Leituras</div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Leitura Água</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={agua_leitura}
                onChange={(e) => {
                  setAguaLeitura(e.target.value);
                  setDirty(true);
                }}
                placeholder="ex: 12345"
                disabled={disableAll || mismatch}
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Leitura Energia</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={energia_leitura}
                onChange={(e) => {
                  setEnergiaLeitura(e.target.value);
                  setDirty(true);
                }}
                placeholder="ex: 67890"
                disabled={disableAll || mismatch}
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Leitura Gás (opcional)</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={gas_leitura}
                onChange={(e) => {
                  setGasLeitura(e.target.value);
                  setDirty(true);
                }}
                placeholder="se não tiver, deixe vazio"
                disabled={disableAll || mismatch}
                inputMode="decimal"
              />
              <div className="mt-1 text-[11px] text-gray-500">Se o condomínio não usa gás, deixe vazio.</div>
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
              disabled={disableAll || mismatch}
            />
          </div>

          <div className="mt-6 rounded-2xl border p-4">
            <div className="mb-2 text-sm font-semibold text-gray-700">Fotos (checklist)</div>
            <div className="text-xs text-gray-500">Tocar em “Tirar” → depois “Salvar”.</div>

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
                  <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                    Pendente
                  </span>
                ) : item.required ? (
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                    Obrigatória
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Opcional</span>
                );

                return (
                  <div key={item.kind} className="flex flex-col gap-3 p-3 md:flex-row md:items-start md:justify-between">
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
                              -{" "}
                              <button className="underline" onClick={() => setPreviewKind(item.kind)}>
                                Ver
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ✅ MOBILE: stack 100% / DESKTOP: em linha */}
                    <div className="w-full md:w-auto">
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <label
                          className={`inline-flex w-full sm:w-auto items-center justify-center cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                            disableAll || mismatch ? "bg-gray-300" : "bg-blue-600 hover:bg-blue-700"
                          }`}
                          title={disableAll ? "Somente leitura" : mismatch ? "Sem permissão" : "Abrir câmera"}
                        >
                          Tirar
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              onPick(item.kind, e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                            disabled={disableAll || mismatch || busy}
                          />
                        </label>

                        <label
                          className={`inline-flex w-full sm:w-auto items-center justify-center cursor-pointer rounded-xl border px-4 py-2 text-sm ${
                            disableAll || mismatch ? "opacity-50" : "hover:bg-gray-50"
                          }`}
                          title="Selecionar da galeria"
                        >
                          Galeria
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              onPick(item.kind, e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                            disabled={disableAll || mismatch || busy}
                          />
                        </label>

                        {pend && (
                          <>
                            <button
                              className={`inline-flex w-full sm:w-auto items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                                disableAll || mismatch ? "bg-gray-300" : "bg-green-600 hover:bg-green-700"
                              }`}
                              disabled={disableAll || mismatch || busy}
                              onClick={() => uploadFoto(item.kind, pendingFile[item.kind] as File)}
                              title="Enviar e salvar no sistema"
                            >
                              {busy ? "Enviando..." : "Salvar"}
                            </button>

                            <button
                              className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                              disabled={disableAll || mismatch || busy}
                              onClick={() => cancelPending(item.kind)}
                              title="Descartar esta seleção"
                            >
                              Refazer
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {!concluida && (
              <div className="mt-3 text-xs text-gray-500">
                Dica: o ideal é salvar todas as fotos obrigatórias antes de concluir.
              </div>
            )}
          </div>

          {/* ✅ NOVO: Provetas por lavadora (não bloqueia Concluir ainda) */}
          <div className="mt-6 rounded-2xl border p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-1 text-sm font-semibold text-gray-700">Provetas (por lavadora)</div>
                <div className="text-xs text-gray-500">
                  1 foto por lavadora. Celular: “Tirar” abre a câmera. PC: use “Galeria” para enviar JPG/JPEG.
                </div>
              </div>
              <div className="text-xs font-semibold">
                Status:{" "}
                {provetasStatus.okAll ? (
                  <span className="text-green-700">OK</span>
                ) : (
                  <span className="text-red-700">
                    Pendente ({provetasStatus.done}/{provetasStatus.total})
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {Array.from({ length: numLavadoras > 0 ? numLavadoras : 1 }).map((_, i) => {
                const idx = i + 1;
                const key = `lavadora:${idx}`;
                const savedUrl = provetasMap.get(key) || "";
                const saved = !!savedUrl;

                const pend = !!provetaPendingFile[idx];
                const pUrl = provetaPendingUrl[idx];
                const busy = !!provetaUploading[idx];

                const badge = saved ? (
                  <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">Feita</span>
                ) : pend ? (
                  <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                    Pendente
                  </span>
                ) : (
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Obrigatória</span>
                );

                return (
                  <div key={key} className="flex flex-col gap-3 rounded-xl border p-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-gray-800">Proveta Lavadora {idx}</div>
                        {badge}
                      </div>

                      {saved && savedUrl && (
                        <div className="mt-1">
                          <a className="text-xs underline text-gray-600" href={savedUrl} target="_blank" rel="noreferrer">
                            Abrir arquivo
                          </a>
                        </div>
                      )}

                      {pend && (
                        <div className="mt-1 text-xs text-gray-600">
                          Selecionada: <b>{provetaPendingFile[idx]?.name ?? "proveta.jpg"}</b>
                          {pUrl && (
                            <>
                              {" "}
                              -{" "}
                              <button className="underline" onClick={() => setPreviewProvetaIdx(idx)}>
                                Ver
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="w-full md:w-auto">
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <label
                          className={`inline-flex w-full sm:w-auto items-center justify-center cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                            disableAll || mismatch ? "bg-gray-300" : "bg-blue-600 hover:bg-blue-700"
                          }`}
                          title={disableAll ? "Somente leitura" : mismatch ? "Sem permissão" : "Abrir câmera"}
                        >
                          Tirar
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              onPickProveta(idx, e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                            disabled={disableAll || mismatch || busy}
                          />
                        </label>

                        <label
                          className={`inline-flex w-full sm:w-auto items-center justify-center cursor-pointer rounded-xl border px-4 py-2 text-sm ${
                            disableAll || mismatch ? "opacity-50" : "hover:bg-gray-50"
                          }`}
                          title="Selecionar arquivo (JPG/JPEG/PNG)"
                        >
                          Galeria
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              onPickProveta(idx, e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                            disabled={disableAll || mismatch || busy}
                          />
                        </label>

                        {pend && (
                          <>
                            <button
                              className={`inline-flex w-full sm:w-auto items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                                disableAll || mismatch ? "bg-gray-300" : "bg-green-600 hover:bg-green-700"
                              }`}
                              disabled={disableAll || mismatch || busy}
                              onClick={() => uploadProveta(idx, provetaPendingFile[idx] as File)}
                              title="Enviar e salvar no sistema"
                            >
                              {busy ? "Enviando..." : "Salvar"}
                            </button>

                            <button
                              className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                              disabled={disableAll || mismatch || busy}
                              onClick={() => cancelPendingProveta(idx)}
                              title="Descartar esta seleção"
                            >
                              Refazer
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {!concluida && (
              <div className="mt-3 text-xs text-gray-500">
                Obs: por enquanto isso não bloqueia “Concluir em campo”. Quando você quiser, a gente liga como obrigatório.
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className={`w-full sm:w-auto rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-300"
              }`}
              onClick={() => salvarRascunho()}
              disabled={disableAll || mismatch || !dirty}
              title={dirty ? "Salvar alterações" : "Sem alterações"}
            >
              {saving ? "Salvando..." : dirty ? "Salvar" : "Sem alterações"}
            </button>

            <a
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl border px-5 py-2 text-sm hover:bg-gray-50"
              href="/auditorias"
            >
              Voltar
            </a>
          </div>
        </div>

        {/* Preview modal (checklist) */}
        {previewKind && pendingUrl[previewKind] && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-semibold">
                  {FOTO_ITEMS.find((x) => x.kind === previewKind)?.label}
                </div>
                <button
                  className="shrink-0 rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
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

        {/* Preview modal (provetas) */}
        {previewProvetaIdx && provetaPendingUrl[previewProvetaIdx] && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-semibold">Proveta Lavadora {previewProvetaIdx}</div>
                <button
                  className="shrink-0 rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={() => setPreviewProvetaIdx(null)}
                >
                  Fechar
                </button>
              </div>
              <div className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={provetaPendingUrl[previewProvetaIdx] as string}
                  alt="preview proveta"
                  className="max-h-[70vh] w-full rounded-xl object-contain"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
