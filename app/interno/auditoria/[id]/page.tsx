"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

/** Imagem (png/jpg/jpeg) -> JPG (client-only, opcional) */
async function imageToJpeg(file: File): Promise<File> {
  if (file.type === "image/jpeg" || file.type === "image/jpg") return file;

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas não disponível");

    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar JPG"))),
        "image/jpeg",
        0.9
      );
    });

    const nameBase = (file.name || "imagem").replace(/\.(png|jpe?g)$/i, "");
    return new File([blob], `${nameBase}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Role = "auditor" | "interno" | "gestor";
type PagamentoMetodo = "direto" | "boleto";

type Me = {
  user: { id: string; email: string };
  role: Role | null;
};

type FotoKind = "agua" | "energia" | "gas" | "comprovante_fechamento";

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref: string | null;
  status: string | null;

  // fotos
  foto_agua_url?: string | null;
  foto_energia_url?: string | null;
  foto_gas_url?: string | null;

  // fechamento
  comprovante_fechamento_url?: string | null;
  fechamento_obs?: string | null;

  pagamento_metodo?: PagamentoMetodo | null;

  condominios?: { nome?: string; cidade?: string; uf?: string } | null;
  condominio?: { nome?: string; cidade?: string; uf?: string } | null;
};

function toLower(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${String(input)} retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`
    );
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Falha na requisição");
  return json;
}

type FotoBlockProps = {
  title: string;
  kind: FotoKind;
  url: string | null | undefined;
  disabled: boolean;
  isUploading?: boolean;
  isRemoving?: boolean;
  onPickFile: (kind: FotoKind, file: File) => void;
  onRemove: (column: keyof Aud) => void;
  column: keyof Aud;
};

function FotoBlock({
  title,
  kind,
  url,
  disabled,
  isUploading,
  isRemoving,
  onPickFile,
  onRemove,
  column,
}: FotoBlockProps) {
  const has = !!url;
  const statusText = isUploading ? "Enviando..." : isRemoving ? "Removendo..." : null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-xs text-gray-500">
            {has ? "Imagem anexada" : "Nenhuma imagem anexada"}
            {statusText ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                {statusText}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            className={`cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50 ${
              disabled ? "opacity-60 pointer-events-none" : ""
            }`}
            title={has ? "Substituir imagem" : "Anexar imagem"}
          >
            {isUploading ? "Enviando..." : has ? "Substituir" : "Anexar"}
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/jpg,image/png"
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(kind, f);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {has ? (
            <button
              className={`rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 ${
                disabled ? "opacity-60 pointer-events-none" : ""
              }`}
              onClick={() => onRemove(column)}
              disabled={disabled}
              title="Remover (limpa o campo no banco; não apaga do storage)"
            >
              {isRemoving ? "Removendo..." : "Remover"}
            </button>
          ) : null}
        </div>
      </div>

      {has ? (
        <div className="mt-3">
          <a href={String(url)} target="_blank" rel="noreferrer" className="inline-block">
            <img
              src={String(url)}
              alt={title}
              loading="lazy"
              className={`max-h-64 rounded-xl border border-gray-200 shadow-sm hover:opacity-90 ${
                statusText ? "opacity-60" : ""
              }`}
            />
          </a>
          <div className="mt-1 text-xs text-gray-500">Clique para abrir em tamanho original</div>
        </div>
      ) : null}
    </div>
  );
}

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);

  const [fechamentoObs, setFechamentoObs] = useState("");
  const [uploadingAny, setUploadingAny] = useState<null | FotoKind>(null);
  const [removingAny, setRemovingAny] = useState<null | keyof Aud>(null);
  const [finalizando, setFinalizando] = useState(false);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const meJson = await fetchJSON("/api/me");
      setMe(meJson);

      const audJson = await fetchJSON(`/api/auditorias/${id}`);
      const audRow: Aud = audJson?.data ?? audJson;

      setAud(audRow);
      setFechamentoObs(String(audRow?.fechamento_obs ?? ""));
    } catch (e: any) {
      setErr(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  const isFinal = useMemo(() => toLower(aud?.status) === "final", [aud?.status]);
  const exigeComprovante = useMemo(() => aud?.pagamento_metodo === "direto", [aud?.pagamento_metodo]);

  async function uploadFoto(kind: FotoKind, file: File) {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setUploadingAny(kind);
    setErr(null);

    try {
      const allowed = ["image/jpeg", "image/jpg", "image/png"];
      if (!allowed.includes(file.type)) {
        throw new Error("Formato inválido. Envie apenas imagem JPG ou PNG.");
      }

      const sendFile = await imageToJpeg(file);

      const form = new FormData();
      form.append("kind", kind);
      form.append("file", sendFile);

      if (kind === "comprovante_fechamento" && String(fechamentoObs ?? "").trim()) {
        form.append("fechamento_obs", String(fechamentoObs).trim());
      }

      const res = await fetch(`/api/auditorias/${audId}/fotos`, {
        method: "POST",
        body: form,
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `/api/auditorias/${audId}/fotos retornou ${res.status} (não-JSON). Trecho: ${text.slice(0, 200)}`
        );
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao enviar imagem");

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao enviar imagem");
    } finally {
      setUploadingAny(null);
    }
  }

  async function removerColuna(column: keyof Aud) {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setRemovingAny(column);
    setErr(null);

    try {
      await fetchJSON(`/api/auditorias/${audId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [column]: null }),
      });

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao remover imagem");
    } finally {
      setRemovingAny(null);
    }
  }

  async function finalizarAuditoria() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    try {
      setErr(null);
      setFinalizando(true);

      if (exigeComprovante && !aud?.comprovante_fechamento_url) {
        throw new Error("Pagamento direto: anexe o comprovante para finalizar.");
      }

      await fetchJSON(`/api/auditorias/${audId}/finalizar`, { method: "POST" });
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao finalizar");
    } finally {
      setFinalizando(false);
    }
  }

  const canEdit = !isFinal;
  const busy = loading || finalizando || uploadingAny !== null || removingAny !== null;

  return (
    <AppShell title="Fechamento (Interno)">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* BLOCO: MEDIDORES */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Fotos dos medidores</div>
              <div className="mt-1 text-sm text-gray-600">
                Anexe, substitua ou remova as fotos de água/energia/gás.{" "}
                {isFinal ? "Auditoria finalizada: edição bloqueada." : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <FotoBlock
              title="Medidor de água"
              kind="agua"
              url={aud?.foto_agua_url}
              disabled={!canEdit || busy}
              isUploading={uploadingAny === "agua"}
              isRemoving={removingAny === "foto_agua_url"}
              onPickFile={uploadFoto}
              onRemove={removerColuna}
              column="foto_agua_url"
            />
            <FotoBlock
              title="Medidor de energia"
              kind="energia"
              url={aud?.foto_energia_url}
              disabled={!canEdit || busy}
              isUploading={uploadingAny === "energia"}
              isRemoving={removingAny === "foto_energia_url"}
              onPickFile={uploadFoto}
              onRemove={removerColuna}
              column="foto_energia_url"
            />
            <FotoBlock
              title="Medidor de gás"
              kind="gas"
              url={aud?.foto_gas_url}
              disabled={!canEdit || busy}
              isUploading={uploadingAny === "gas"}
              isRemoving={removingAny === "foto_gas_url"}
              onPickFile={uploadFoto}
              onRemove={removerColuna}
              column="foto_gas_url"
            />
          </div>
        </div>

        {/* BLOCO: COMPROVANTE + OBS + FINALIZAR */}
        <div className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Comprovante de fechamento</div>
              <div className="mt-1 text-sm text-gray-600">
                {exigeComprovante
                  ? "Pagamento direto: é obrigatório anexar o comprovante (imagem)."
                  : "Boleto: comprovante não é obrigatório."}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <FotoBlock
              title="Comprovante (fechamento)"
              kind="comprovante_fechamento"
              url={aud?.comprovante_fechamento_url}
              disabled={!canEdit || busy}
              isUploading={uploadingAny === "comprovante_fechamento"}
              isRemoving={removingAny === "comprovante_fechamento_url"}
              onPickFile={uploadFoto}
              onRemove={removerColuna}
              column="comprovante_fechamento_url"
            />
          </div>

          <textarea
            className="mt-4 w-full rounded-xl border p-3 text-sm disabled:bg-gray-50"
            rows={3}
            placeholder="Observações do financeiro (opcional)"
            value={fechamentoObs}
            onChange={(e) => setFechamentoObs(e.target.value)}
            disabled={isFinal}
          />

          <button
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={finalizarAuditoria}
            disabled={busy || isFinal}
          >
            {isFinal ? "Auditoria finalizada" : finalizando ? "Finalizando..." : "Finalizar auditoria"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
