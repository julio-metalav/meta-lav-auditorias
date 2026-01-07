"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Me = { user: { id: string; email: string }; role: string };

export default function AuditoriaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setErr(null);
    const [m, r] = await Promise.all([
      fetch("/api/me").then((x) => x.json()),
      fetch(`/api/auditorias/${id}`).then((x) => x.json()),
    ]);

    if (m?.error) {
      setErr(m.error);
      return;
    }
    setMe(m);

    if (r?.error) {
      setErr(r.error);
      return;
    }
    setData(r.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const mapsUrl = useMemo(() => {
    const c = data?.condominios;
    if (!c) return "";
    const parts = [c.rua, c.numero, c.bairro, c.cidade, c.uf, c.cep]
      .map((x: any) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");
    return parts
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          parts
        )}`
      : "";
  }, [data]);

  async function patch(p: any) {
    setSaving(true);
    const r = await fetch(`/api/auditorias/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);

    if (!r.ok) {
      setErr(j?.error || "Erro ao salvar");
      return false;
    }
    await load();
    return true;
  }

  async function uploadAndSet(field: string, file: File) {
    setErr(null);

    const bucket = "auditorias";

    // extensão segura
    const extFromName = (file.name.split(".").pop() || "").toLowerCase();
    const ext =
      extFromName && extFromName.length <= 10 ? extFromName : "bin";

    const path = `${id}/${field}.${ext}`;

    const { error: upErr } = await supabaseBrowser.storage
      .from(bucket)
      .upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });

    if (upErr) {
      setErr(upErr.message);
      return;
    }

    const { data: pub } = supabaseBrowser.storage
      .from(bucket)
      .getPublicUrl(path);

    if (!pub?.publicUrl) {
      setErr("Upload OK, mas não consegui gerar a URL pública do arquivo.");
      return;
    }

    await patch({ [field]: pub.publicUrl });
  }

  const isAuditor = me?.role === "auditor";
  const isInterno = me?.role === "interno" || me?.role === "gestor";

  return (
    <AppShell title="Auditoria (detalhe)">
      {err && <p style={{ color: "#b42318" }}>{err}</p>}
      {!err && !data && <p className="small">Carregando...</p>}

      {data && (
        <>
          <div className="card" style={{ background: "#fbfcff" }}>
            <div
              style={{
                fontWeight: 700,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>{data?.condominios?.nome || data?.condominio_id}</span>
              <span className="badge">{data.status}</span>
            </div>
            <div className="small">Mês ref: {data.mes_ref}</div>
            <div className="small">ID: {data.id}</div>

            {mapsUrl && (
              <div style={{ marginTop: 8 }}>
                <a className="btn" href={mapsUrl} target="_blank" rel="noreferrer">
                  Abrir no Google Maps
                </a>
              </div>
            )}
          </div>

          <div style={{ height: 12 }} />

          <div className="grid2">
            <div className="card">
              <div className="small" style={{ marginBottom: 8 }}>
                Leituras (campo)
              </div>

              <div className="grid2">
                <div>
                  <div className="small">Água (m³)</div>
                  <input
                    className="input"
                    value={data.agua_leitura ?? ""}
                    disabled={!isAuditor}
                    onChange={(e) =>
                      setData({ ...data, agua_leitura: e.target.value })
                    }
                  />
                </div>

                <div>
                  <div className="small">Energia (kWh)</div>
                  <input
                    className="input"
                    value={data.energia_leitura ?? ""}
                    disabled={!isAuditor}
                    onChange={(e) =>
                      setData({ ...data, energia_leitura: e.target.value })
                    }
                  />
                </div>

                <div>
                  <div className="small">Gás (m³, se houver)</div>
                  <input
                    className="input"
                    value={data.gas_leitura ?? ""}
                    disabled={!isAuditor}
                    onChange={(e) =>
                      setData({ ...data, gas_leitura: e.target.value })
                    }
                  />
                </div>
              </div>

              <div style={{ height: 8 }} />
              <div className="small">Químicos</div>

              <div className="grid2">
                <div>
                  <div className="small">Detergente (ml)</div>
                  <input
                    className="input"
                    value={data.quimicos_detergente_ml ?? ""}
                    disabled={!isAuditor}
                    onChange={(e) =>
                      setData({
                        ...data,
                        quimicos_detergente_ml: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <div className="small">Amaciante (ml)</div>
                  <input
                    className="input"
                    value={data.quimicos_amaciante_ml ?? ""}
                    disabled={!isAuditor}
                    onChange={(e) =>
                      setData({
                        ...data,
                        quimicos_amaciante_ml: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              {isAuditor && (
                <div
                  className="row"
                  style={{ justifyContent: "flex-end", marginTop: 10 }}
                >
                  <button
                    className="btn primary"
                    onClick={() =>
                      patch({
                        agua_leitura: data.agua_leitura
                          ? Number(data.agua_leitura)
                          : null,
                        energia_leitura: data.energia_leitura
                          ? Number(data.energia_leitura)
                          : null,
                        gas_leitura: data.gas_leitura
                          ? Number(data.gas_leitura)
                          : null,
                        quimicos_detergente_ml: data.quimicos_detergente_ml
                          ? Number(data.quimicos_detergente_ml)
                          : null,
                        quimicos_amaciante_ml: data.quimicos_amaciante_ml
                          ? Number(data.quimicos_amaciante_ml)
                          : null,
                        status: data.status || "em_campo",
                      })
                    }
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar leituras"}
                  </button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="small" style={{ marginBottom: 8 }}>
                Anexos (fotos e PDFs)
              </div>

              {/* FOTOS: abre câmera no celular */}
              <UploadRow
                label="Foto medidor de água"
                current={data.foto_agua_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_agua_url", f)}
              />
              <UploadRow
                label="Foto medidor de energia"
                current={data.foto_energia_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_energia_url", f)}
              />
              <UploadRow
                label="Foto medidor de gás"
                current={data.foto_gas_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_gas_url", f)}
              />
              <UploadRow
                label="Foto proveta"
                current={data.foto_proveta_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_proveta_url", f)}
              />
              <UploadRow
                label="Foto bombonas"
                current={data.foto_bombonas_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_bombonas_url", f)}
              />
              <UploadRow
                label="Foto cabo bala"
                current={data.foto_cabo_bala_url}
                disabled={!isAuditor}
                accept="image/*"
                capture="environment"
                onPick={(f) => uploadAndSet("foto_cabo_bala_url", f)}
              />

              <div style={{ height: 10 }} />

              {/* PDF: não abre câmera */}
              <UploadRow
                label="Comprovante cashback (PDF)"
                current={data.cashback_comprovante_url}
                disabled={!isInterno}
                accept="application/pdf"
                onPick={(f) => uploadAndSet("cashback_comprovante_url", f)}
              />

              <div style={{ height: 12 }} />

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {isAuditor && (
                  <button
                    className="btn"
                    disabled={saving}
                    onClick={() => patch({ status: "em_conferencia" })}
                  >
                    Enviar p/ conferência
                  </button>
                )}
                {isInterno && (
                  <button
                    className="btn primary"
                    disabled={saving}
                    onClick={() => patch({ status: "final" })}
                  >
                    Fechar como FINAL
                  </button>
                )}
              </div>

              <p className="small" style={{ marginTop: 10 }}>
                Observação: o bucket <b>auditorias</b> precisa existir no Supabase
                Storage.
              </p>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function UploadRow({
  label,
  current,
  disabled,
  onPick,
  accept,
  capture,
}: {
  label: string;
  current?: string;
  disabled?: boolean;
  onPick: (f: File) => void;
  accept?: string;
  capture?: "environment" | "user";
}) {
  return (
    <div
      className="row"
      style={{
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <div style={{ flex: 1 }}>
        <div className="small">{label}</div>
        {current ? (
          <a className="small" href={current} target="_blank" rel="noreferrer">
            Ver arquivo
          </a>
        ) : (
          <div className="small">(não enviado)</div>
        )}
      </div>

      <input
        type="file"
        disabled={disabled}
        accept={accept || "image/*"}
        capture={capture}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
