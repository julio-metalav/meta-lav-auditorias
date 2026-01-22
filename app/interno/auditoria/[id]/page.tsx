"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/components/AppShell";

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

  agua_leitura?: number | null;
  energia_leitura?: number | null;
  gas_leitura?: number | null;

  base_agua?: number | null;
  base_energia?: number | null;
  base_gas?: number | null;

  comprovante_fechamento_url?: string | null;
  fechamento_obs?: string | null;

  pagamento_metodo?: PagamentoMetodo | null;

  cashback_percent?: number | null;
  agua_valor_m3?: number | null;
  energia_valor_kwh?: number | null;
  gas_valor_m3?: number | null;

  condominios?: { nome: string; cidade: string; uf: string; cashback_percent?: number | null } | null;
  condominio?: { id?: string; nome?: string; cidade?: string; uf?: string } | null;
};

type CicloItem = {
  id?: string | null;
  ciclos: number;
  categoria?: "lavadora" | "secadora" | string | null;
  capacidade_kg?: number | null;
  valor_ciclo?: number | null;
};

const BRAND = {
  azul: "#104774",
  azulEscuro: "#0D3A60",
  laranja: "#F79232",
  aqua: "#1BABCD",
  fundo: "#F3F7FB",
};

const card = "rounded-2xl border border-gray-100 bg-white p-5 shadow-sm";
const btnGhost =
  "rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-60";
const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

function toLower(x: any) {
  return String(x ?? "").toLowerCase().trim();
}
function safeNumber(x: any, fb = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}
function moneyBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

  const role = me?.role ?? null;
  const isStaff = role === "interno" || role === "gestor";
  const isFinal = toLower(aud?.status) === "final";
  const exigeComprovante = aud?.pagamento_metodo === "direto";

  useEffect(() => {
    carregar();
    // eslint-disable-next-line
  }, [id]);

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      const meJson = await fetch("/api/me").then((r) => r.json());
      setMe(meJson);

      const audJson = await fetch(`/api/auditorias/${id}`).then((r) => r.json());
      const row = audJson?.data ?? audJson;
      setAud(row);
      setFechamentoObs(row?.fechamento_obs ?? "");
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function uploadComprovante(file: File) {
    setUploadingComprovante(true);
    try {
      const form = new FormData();
      form.append("kind", "comprovante_fechamento");
      form.append("file", file);
      await fetch(`/api/auditorias/${id}/fotos`, { method: "POST", body: form });
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao enviar comprovante");
    } finally {
      setUploadingComprovante(false);
    }
  }

  async function finalizarAuditoria() {
    if (exigeComprovante && !aud?.comprovante_fechamento_url) {
      setErr("Pagamento direto: anexe o comprovante para finalizar.");
      return;
    }
    setFinalizando(true);
    try {
      await fetch(`/api/auditorias/${id}/finalizar`, { method: "POST" });
      await carregar();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao finalizar");
    } finally {
      setFinalizando(false);
    }
  }

  return (
    <AppShell title="Fechamento (Interno)">
      <div
        className="min-h-[calc(100vh-64px)]"
        style={{ background: `linear-gradient(180deg, ${BRAND.fundo}, #fff 40%)` }}
      >
        <div className="mx-auto max-w-5xl px-4 py-6">
          {/* HEADER */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-extrabold" style={{ color: BRAND.azul }}>
                Fechamento (Interno)
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className={`${badge} bg-white ring-1 ring-gray-200`}>
                  Status:{" "}
                  <b
                    style={{
                      color:
                        aud?.status === "final"
                          ? "#065f46"
                          : aud?.status === "aberta"
                          ? BRAND.azul
                          : BRAND.laranja,
                    }}
                  >
                    {aud?.status}
                  </b>
                </span>
                <span className={`${badge} bg-white ring-1 ring-gray-200`}>
                  Pagamento: <b>{aud?.pagamento_metodo ?? "—"}</b>
                </span>
                <span className={`${badge} bg-white ring-1 ring-gray-200 font-mono`}>
                  {id}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button className={btnGhost} onClick={() => history.back()}>
                Voltar
              </button>
            </div>
          </div>

          {err && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {err}
            </div>
          )}

          {/* COMPROVANTE */}
          <div className={card}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold">Comprovante de fechamento</div>
                <div className="mt-1 text-sm text-gray-600">
                  {exigeComprovante ? "Pagamento direto exige comprovante." : "Boleto: comprovante opcional."}
                </div>
                <div className="mt-2">
                  {aud?.comprovante_fechamento_url ? (
                    <span className={`${badge}`} style={{ background: BRAND.aqua, color: "#fff" }}>
                      anexado
                    </span>
                  ) : (
                    <span className={`${badge}`} style={{ background: BRAND.laranja, color: "#fff" }}>
                      pendente
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <label
                  className={`${btnGhost} cursor-pointer ${isFinal ? "pointer-events-none opacity-60" : ""}`}
                >
                  {uploadingComprovante ? "Enviando..." : "Anexar comprovante"}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={(e) => e.target.files && uploadComprovante(e.target.files[0])}
                  />
                </label>

                {/* 🔥 CTA PRINCIPAL */}
                <button
                  onClick={finalizarAuditoria}
                  disabled={finalizando || isFinal}
                  className="rounded-xl px-5 py-2 text-sm font-extrabold text-white shadow-sm disabled:opacity-60"
                  style={{ backgroundColor: BRAND.laranja }}
                >
                  {finalizando ? "Finalizando..." : isFinal ? "Finalizada" : "Finalizar auditoria"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold">Obs do financeiro</div>
              <textarea
                className="mt-2 w-full rounded-xl border border-gray-200 p-3 text-sm"
                rows={3}
                value={fechamentoObs}
                onChange={(e) => setFechamentoObs(e.target.value)}
                disabled={isFinal}
              />
            </div>
          </div>
          {/* INFO FINAL */}
          <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-xs text-gray-500">
            Meta-Lav · Auditorias · 2026
          </div>
        </div>
      </div>
    </AppShell>
  );
}
