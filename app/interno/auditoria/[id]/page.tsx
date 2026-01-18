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

    const nameBase = (file.name || "comprovante").replace(/\.(png|jpe?g)$/i, "");
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

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref: string | null;
  status: string | null;

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

export default function InternoAuditoriaPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [aud, setAud] = useState<Aud | null>(null);

  const [fechamentoObs, setFechamentoObs] = useState("");
  const [uploadingComprovante, setUploadingComprovante] = useState(false);
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

  async function uploadComprovante(file: File) {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    setUploadingComprovante(true);
    setErr(null);

    try {
      const allowed = ["image/jpeg", "image/jpg", "image/png"];
      if (!allowed.includes(file.type)) {
        throw new Error("Formato inválido. Envie apenas imagem JPG ou PNG.");
      }

      const sendFile = await imageToJpeg(file);

      const form = new FormData();
      form.append("kind", "comprovante_fechamento");
      form.append("file", sendFile);
      if (String(fechamentoObs ?? "").trim()) {
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
      if (!res.ok) throw new Error(json?.error ?? "Falha ao enviar comprovante");

      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao enviar comprovante");
    } finally {
      setUploadingComprovante(false);
    }
  }

  async function finalizarAuditoria() {
    const audId = String(aud?.id ?? id).trim();
    if (!audId) return;

    try {
      setErr(null);
      setFinalizando(true);

      if (aud?.pagamento_metodo === "direto" && !aud?.comprovante_fechamento_url) {
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

  const exigeComprovante = aud?.pagamento_metodo === "direto";
  const isFinal = toLower(aud?.status) === "final";

  return (
    <AppShell title="Fechamento (Interno)">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Comprovante de fechamento</div>
              <div className="mt-1 text-sm text-gray-600">
                {exigeComprovante
                  ? "Pagamento direto: é obrigatório anexar o comprovante (imagem)."
                  : "Boleto: comprovante não é obrigatório."}
              </div>
            </div>

            <label className="cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold">
              {uploadingComprovante ? "Enviando..." : "Anexar imagem"}
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/jpg,image/png"
                disabled={uploadingComprovante || isFinal}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadComprovante(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          {/* 🔍 PREVIEW DO COMPROVANTE */}
          {aud?.comprovante_fechamento_url && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold text-gray-700">
                Pré-visualização do comprovante
              </div>

              <a
                href={aud.comprovante_fechamento_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block"
              >
                <img
                  src={aud.comprovante_fechamento_url}
                  alt="Comprovante de fechamento"
                  loading="lazy"
                  className="max-h-64 rounded-xl border border-gray-200 shadow-sm hover:opacity-90"
                />
              </a>

              <div className="mt-1 text-xs text-gray-500">
                Clique na imagem para abrir em tamanho original
              </div>
            </div>
          )}

          <textarea
            className="mt-4 w-full rounded-xl border p-3 text-sm"
            rows={3}
            placeholder="Observações do financeiro (opcional)"
            value={fechamentoObs}
            onChange={(e) => setFechamentoObs(e.target.value)}
            disabled={isFinal}
          />

          <button
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={finalizarAuditoria}
            disabled={finalizando || loading || isFinal}
          >
            {isFinal ? "Auditoria finalizada" : finalizando ? "Finalizando..." : "Finalizar auditoria"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
