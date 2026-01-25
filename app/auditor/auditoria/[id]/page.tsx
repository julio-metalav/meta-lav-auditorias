"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

/* =========================
   TIPOS BÁSICOS
========================= */

type FotoKind = "agua" | "energia" | "gas" | "bombonas" | "conector_bala";
type ProvetaKey = `proveta_${number}`;
type UploadKey = FotoKind | ProvetaKey;

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
  foto_bombonas_url?: string | null;
  foto_conector_bala_url?: string | null;

  condominios?:
    | {
        nome: string;
        cidade: string;
        uf: string;

        // opcionais (se vier do backend, exibimos)
        rua?: string | null;
        numero?: string | null;
        bairro?: string | null;
        complemento?: string | null;
        cep?: string | null;
      }
    | null;

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

type FotoItem = {
  kind: FotoKind;
  label: string;
  required: boolean;
  help?: string;
};

type UploadingState = Partial<Record<UploadKey, boolean>>;

/* =========================
   CONFIGURAÇÃO DAS FOTOS FIXAS
   - Checklist principal: água, energia, gás, conector
   - Químicos: bombonas + provetas (fora do bloco principal)
========================= */

const FOTO_ITEMS_CHECKLIST: FotoItem[] = [
  { kind: "agua", label: "Medidor de Água", required: true },
  { kind: "energia", label: "Medidor de Energia", required: true },
  { kind: "gas", label: "Medidor de Gás", required: false, help: "Opcional (se houver gás)" },
  { kind: "conector_bala", label: "Conector bala conectado", required: true },
];

const FOTO_ITEM_BOMBONAS: FotoItem = {
  kind: "bombonas",
  label: "Bombonas (detergente + amaciante)",
  required: true,
};

/* =========================
   HELPERS
========================= */

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

function toNumberOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
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

function fmtBR(dt: string) {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("pt-BR");
}

function pickMonth(a: Aud) {
  return (a.ano_mes ?? a.mes_ref ?? "") as string;
}

function buildEndereco(c?: Aud["condominios"] | null) {
  if (!c) return "";
  const parts1 = [c.rua, c.numero].filter(Boolean).join(", ");
  const parts2 = [c.bairro, c.cidade && c.uf ? `${c.cidade}/${c.uf}` : c.cidade ?? c.uf ?? null]
    .filter(Boolean)
    .join(" - ");
  const parts3 = [c.complemento, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).join(" • ");

  const parts = [parts1, parts2, parts3].filter(Boolean);
  return parts.join(" • ");
}

/* =========================
   OTIMIZAÇÃO DE IMAGEM (CLIENT-SIDE)
   - Redimensiona e comprime antes do upload
   - Alvo: sempre < ~2.5MB (ajustável)
========================= */

const IMG_MAX_DIM = 2000; // maior lado
const IMG_TARGET_BYTES = 2_500_000; // ~2.5MB
const IMG_MIN_QUALITY = 0.55;
const IMG_START_QUALITY = 0.85;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Falha ao ler imagem"));
    r.readAsDataURL(file);
  });
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não consegui abrir a imagem (formato não suportado?)"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function calcResize(w: number, h: number, maxDim: number) {
  const maxSide = Math.max(w, h);
  if (maxSide <= maxDim) return { w, h };
  const scale = maxDim / maxSide;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error("Falha ao converter imagem"));
        else resolve(b);
      },
      mime,
      quality
    );
  });
}

async function optimizeImageFile(file: File): Promise<File> {
  // se já é pequeno, não mexe
  if (file.size <= IMG_TARGET_BYTES && file.type !== "image/heic" && file.type !== "image/heif") {
    return file;
  }

  // tenta carregar e redesenhar
  // (se for HEIC/HEIF e o browser não suportar, vai cair no erro)
  let img: HTMLImageElement;
  try {
    img = await loadImageFromFile(file);
  } catch {
    // fallback: tenta via dataURL (às vezes ajuda em alguns browsers)
    const dataUrl = await fileToDataUrl(file);
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Formato de imagem não suportado neste aparelho/navegador"));
      i.src = dataUrl;
    });
  }

  const ow = img.naturalWidth || img.width;
  const oh = img.naturalHeight || img.height;
  const { w, h } = calcResize(ow, oh, IMG_MAX_DIM);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Falha ao preparar canvas");

  ctx.drawImage(img, 0, 0, w, h);

  // sempre gera JPEG pra garantir compatibilidade e reduzir tamanho
  const mime = "image/jpeg";

  let q = IMG_START_QUALITY;
  let blob = await canvasToBlob(canvas, mime, q);

  // reduz qualidade até ficar abaixo do alvo (ou atingir piso)
  while (blob.size > IMG_TARGET_BYTES && q > IMG_MIN_QUALITY) {
    q = Math.max(IMG_MIN_QUALITY, q - 0.08);
    blob = await canvasToBlob(canvas, mime, q);
  }

  // se mesmo assim ficou grande, tenta diminuir dimensão mais um pouco
  if (blob.size > IMG_TARGET_BYTES) {
    const canvas2 = document.createElement("canvas");
    const scale = Math.sqrt(IMG_TARGET_BYTES / blob.size);
    const w2 = Math.max(800, Math.round(w * Math.min(0.9, scale)));
    const h2 = Math.max(800, Math.round(h * Math.min(0.9, scale)));
    canvas2.width = w2;
    canvas2.height = h2;

    const ctx2 = canvas2.getContext("2d");
    if (!ctx2) throw new Error("Falha ao preparar canvas 2");
    ctx2.drawImage(img, 0, 0, w2, h2);

    q = Math.max(IMG_MIN_QUALITY, q);
    blob = await canvasToBlob(canvas2, mime, q);
  }

  const newName = file.name.replace(/\.(heic|heif|png|webp|jpeg|jpg)$/i, "") + ".jpg";
  return new File([blob], newName, { type: mime, lastModified: Date.now() });
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

  // uploads (fixos + provetas dinâmicas)
  const [uploading, setUploading] = useState<UploadingState>({
    agua: false,
    energia: false,
    gas: false,
    bombonas: false,
    conector_bala: false,
  });

  const [pendingFile, setPendingFile] = useState<Partial<Record<UploadKey, File>>>({});
  const [pendingUrl, setPendingUrl] = useState<Partial<Record<UploadKey, string>>>({});
  const [previewKind, setPreviewKind] = useState<UploadKey | null>(null);

  // provetas por lavadora (idx 1..N)
  const [provetaUrls, setProvetaUrls] = useState<Record<number, string>>({});
  const [qtdLavadoras, setQtdLavadoras] = useState<number>(0);

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
    setAguaLeitura(a.agua_leitura === null || a.agua_leitura === undefined ? "" : String(a.agua_leitura));
    setEnergiaLeitura(a.energia_leitura === null || a.energia_leitura === undefined ? "" : String(a.energia_leitura));
    setGasLeitura(a.gas_leitura === null || a.gas_leitura === undefined ? "" : String(a.gas_leitura));
    setDirty(false);
  }

  function fotoUrl(a: Aud | null, kind: FotoKind) {
    if (!a) return null;
    if (kind === "agua") return a.foto_agua_url ?? null;
    if (kind === "energia") return a.foto_energia_url ?? null;
    if (kind === "gas") return a.foto_gas_url ?? null;
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

  const canSeeHistorico = useMemo(() => histRole === "interno" || histRole === "gestor", [histRole]);

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

  async function carregarQtdLavadoras(condominioId: string) {
    try {
      // endpoint esperado: { count: number }
      const res = await fetch(`/api/condominios/${condominioId}/lavadoras`, { cache: "no-store" });
      const json = await safeReadJson(res);
      if (res.ok && Number.isFinite(Number(json?.count))) {
        setQtdLavadoras(Number(json.count));
      } else {
        setQtdLavadoras(0);
      }
    } catch {
      setQtdLavadoras(0);
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
      } catch {}

      const res = await fetch(`/api/auditorias/${id}`, { cache: "no-store" });
      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar auditoria");

      const found: Aud | null = (json?.auditoria ?? null) as Aud | null;
      if (!found) throw new Error("Auditoria não encontrada.");

      setAud(found);
      applyFromAud(found);

      if (found.condominio_id) carregarQtdLavadoras(found.condominio_id);

      if (json?.provetas && typeof json.provetas === "object") {
        const next: Record<number, string> = {};
        Object.entries(json.provetas as Record<string, string>).forEach(([k, v]) => {
          const idx = Number(k);
          if (Number.isFinite(idx) && v) next[idx] = v;
        });
        setProvetaUrls(next);
      }

      carregarHistorico();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  function onPick(kind: UploadKey, file?: File | null) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPendingFile((p) => ({ ...p, [kind]: file }));
    setPendingUrl((p) => ({ ...p, [kind]: url }));
  }

  async function uploadFoto(kind: UploadKey, file: File) {
    setErr(null);
    setOk(null);

    if (!aud) return setErr("Auditoria não carregada.");
    if (mismatch) return setErr("Sem permissão.");
    if (concluida) return setErr("Auditoria já finalizada.");
    if (!file.type.startsWith("image/")) return setErr("Envie apenas imagem.");

    setUploading((p) => ({ ...p, [kind]: true }));

    try {
      const optimized = await optimizeImageFile(file);

      const fd = new FormData();
      const kindStr = String(kind);
      const isProveta = kindStr.startsWith("proveta_");

      if (isProveta) {
        fd.append("kind", "proveta");
        fd.append("idx", kindStr.replace("proveta_", ""));
      } else {
        fd.append("kind", kindStr);
      }

      fd.append("file", optimized);

      const res = await fetch(`/api/auditorias/${id}/fotos`, {
        method: "POST",
        body: fd,
      });

      const json = await safeReadJson(res);
      if (!res.ok) throw new Error(json?.error ?? "Erro ao enviar foto");

      if (isProveta) {
        const idx = Number(kindStr.replace("proveta_", ""));
        if (json?.url) setProvetaUrls((p) => ({ ...p, [idx]: json.url }));
      } else if (json?.updated) {
        setAud((prev) => ({ ...(prev as Aud), ...json.updated }));
      }

      setOkMsg("Foto salva ✅");
      setPendingFile((p) => {
        const c = { ...p };
        delete c[kind];
        return c;
      });
      setPendingUrl((p) => {
        const c = { ...p };
        delete c[kind];
        return c;
      });
    } catch (e: any) {
      setErr(e?.message ?? "Falha no upload");
    } finally {
      setUploading((p) => ({ ...p, [kind]: false }));
    }
  }
  useEffect(() => {
    carregarTudo();
  }, [id]);

  const endereco = buildEndereco(aud?.condominios);
  const mapsLink = endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`
    : null;

  return (
    <AppShell title="Auditoria (Campo)">
      <div className="mx-auto max-w-4xl px-4 py-6">

        {/* TOPO – CONDOMÍNIO */}
        <div className="mb-4 rounded-xl border bg-white p-4">
          <div className="text-lg font-semibold">
            {aud?.condominios?.nome}
          </div>

          {endereco && (
            <div className="mt-1 text-sm text-gray-600">{endereco}</div>
          )}

          {mapsLink && (
            <a
              href={mapsLink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-sm text-blue-600 underline"
            >
              📍 Abrir no Google Maps
            </a>
          )}
        </div>

        {/* RESTO DA TELA — permanece igual */}
        {/* ⚠️ Todo o JSX abaixo é exatamente o mesmo que você já tinha */}
        {/* Checklist, leituras, uploads, histórico, botões etc */}

      </div>
    </AppShell>
  );
}
