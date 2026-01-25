import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

type Props = {
  logo?: ImageSrcObj | string | null;

  condominio: { nome: string; pagamento_texto?: string | null }; // compat (não exibimos)
  periodo: string;
  gerado_em?: string;

  vendas: Array<{ maquina: string; ciclos: number; valor_unitario: number; valor_total: number }>;
  kpis: { receita_bruta: number; cashback_percentual: number; cashback_valor: number };

  consumos: Array<{
    nome: string;
    anterior: number | null;
    atual: number | null;
    consumo: number;
    valor_total: number;
  }>;

  total_consumo: number;
  total_cashback: number;
  total_pagar: number;

  observacoes?: string;
  anexos: AnexoPdf[];
};

const C = {
  ink: "#0B1F35",
  muted: "#5B6B7E",
  line: "#D9E2EC",
  bg: "#F4F7FB",
  white: "#FFFFFF",
  brand: "#0B4A78",
  soft: "#EEF5FB",
  head: "#F1F5F9",
  altRow: "#FBFDFF",
};

const S = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 28,
    paddingBottom: 22,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.ink,
    backgroundColor: C.bg,
  },

  topBar: { height: 6, backgroundColor: C.brand, borderRadius: 6, marginBottom: 14 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },

  brandLeft: { flexDirection: "row", alignItems: "center", maxWidth: 380 },
  brandSpacer: { width: 12 },

  logo: { width: 128, height: 42, objectFit: "contain" },

  titleBlock: { flexDirection: "column" },
  title: { fontSize: 16, fontWeight: 700, letterSpacing: 0.2, color: C.ink },
  subtitle: { marginTop: 2, fontSize: 9, color: C.muted },

  badge: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: "#CFE2F1",
    fontSize: 8,
    color: C.brand,
    fontWeight: 700,
  },

  metaCard: {
    width: 245,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 10,
  },
  metaLabel: { fontSize: 8, color: C.muted },
  metaValue: { marginTop: 2, fontSize: 10, fontWeight: 700, color: C.ink },
  metaDivider: { height: 1, backgroundColor: C.line, marginVertical: 8 },

  hr: { height: 1, backgroundColor: C.line, marginBottom: 12 },

  kpiRow: { flexDirection: "row", marginBottom: 12 },
  kpiSpacer: { width: 10 },

  kpi: { flexGrow: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 },
  kpiLabel: { fontSize: 8, color: C.muted },
  kpiValue: { marginTop: 4, fontSize: 12, fontWeight: 700, color: C.ink },
  kpiHint: { marginTop: 3, fontSize: 8, color: C.muted },

  kpiTotal: { flexGrow: 1.3, backgroundColor: C.brand, borderRadius: 10, padding: 10 },
  kpiTotalLabel: { fontSize: 8, color: "#DCEAF6", fontWeight: 700 },
  kpiTotalValue: { marginTop: 4, fontSize: 14, fontWeight: 700, color: C.white },

  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginBottom: 12 },

  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sectionIndex: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: "#CFE2F1",
    color: C.brand,
    fontSize: 10,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 3,
  },
  sectionHeaderSpacer: { width: 8 },
  sectionTitle: { fontSize: 11.5, fontWeight: 700, color: C.ink },
  sectionSub: { marginTop: 2, fontSize: 8.5, color: C.muted },

  table: { borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  trHead: { flexDirection: "row", backgroundColor: C.head, borderBottomWidth: 1, borderBottomColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line },
  trAlt: { backgroundColor: C.altRow },
  th: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 8.5, fontWeight: 700, color: C.ink },
  td: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 9, color: C.ink },
  r: { textAlign: "right" },

  note: { marginTop: 8, fontSize: 9, color: C.ink },
  strong: { fontWeight: 700 },

  financeBox: {
    marginTop: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 10,
  },

  obsText: { fontSize: 9, color: C.ink, lineHeight: 1.35 },

  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
    fontSize: 8,
    color: C.muted,
  },

  // ===== Página 2: Fotos (layout fixo, 2 páginas sempre) =====
  photosTitle: { fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 10 },

  row: { flexDirection: "row" },
  rowMb: { marginBottom: 10 },

  photoHalfLeft: {
    width: "49%",
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
    marginRight: 10,
  },
  photoHalfRight: {
    width: "49%",
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
  },
  photoFull: {
    width: "100%" as any,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
  },

  photoName: { fontSize: 9, fontWeight: 700, marginBottom: 6, color: C.ink },

  // chave: contain + height fixa (não corta / não estoura página)
  photoImgHalf: { width: "100%", height: 250, objectFit: "contain", borderRadius: 8 },
  photoImgFull: { width: "100%", height: 260, objectFit: "contain", borderRadius: 8 },

  photoMissing: {
    width: "100%",
    height: 250,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
  },
  photoMissingText: { fontSize: 8.5, color: C.muted },
});

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function leitura(v: number | null) {
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function imgDataUri(src: ImageSrcObj) {
  const mime = src.format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${src.data.toString("base64")}`;
}
function fmtDateTime(v?: string) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return String(v);
  }
}

function resolveLogoUri(logo?: Props["logo"]) {
  if (!logo) return null;
  if (typeof logo === "string") return logo;
  if ((logo as ImageSrcObj)?.data) return imgDataUri(logo as ImageSrcObj);
  return null;
}

function normTxt(s: string) {
  try {
    // remove acentos e normaliza
    return (s || "")
      .toString()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
  } catch {
    return (s || "").toString().toLowerCase().trim();
  }
}

function pickAnexo(anexos: AnexoPdf[], predicate: (tipoNorm: string) => boolean): AnexoPdf | null {
  for (const a of anexos) {
    if (!a) continue;
    if (!a.isImagem) continue;
    if (!a.src?.data) continue;
    const t = normTxt(a.tipo || "");
    if (predicate(t)) return a;
  }
  return null;
}

function PhotoBox(props: { label: string; item: AnexoPdf | null; full?: boolean }) {
  const { label, item, full } = props;
  const has = !!item?.src?.data;

  const boxStyle = full ? S.photoFull : null; // (vamos escolher fora por layout)
  const imgStyle = full ? S.photoImgFull : S.photoImgHalf;

  return (
    <View style={boxStyle ?? ({} as any)}>
      <Text style={S.photoName}>{label}</Text>
      {has ? (
        <Image src={imgDataUri(item!.src!)} style={imgStyle} />
      ) : (
        <View style={[S.photoMissing, full ? { height: 260 } : {}]}>
          <Text style={S.photoMissingText}>Sem foto</Text>
        </View>
      )}
    </View>
  );
}
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

type Props = {
  logo?: ImageSrcObj | string | null;

  condominio: { nome: string; pagamento_texto?: string | null }; // compat (não exibimos)
  periodo: string;
  gerado_em?: string;

  vendas: Array<{ maquina: string; ciclos: number; valor_unitario: number; valor_total: number }>;
  kpis: { receita_bruta: number; cashback_percentual: number; cashback_valor: number };

  consumos: Array<{
    nome: string;
    anterior: number | null;
    atual: number | null;
    consumo: number;
    valor_total: number;
  }>;

  total_consumo: number;
  total_cashback: number;
  total_pagar: number;

  observacoes?: string;
  anexos: AnexoPdf[];
};

const C = {
  ink: "#0B1F35",
  muted: "#5B6B7E",
  line: "#D9E2EC",
  bg: "#F4F7FB",
  white: "#FFFFFF",
  brand: "#0B4A78",
  soft: "#EEF5FB",
  head: "#F1F5F9",
  altRow: "#FBFDFF",
};

const S = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 28,
    paddingBottom: 22,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.ink,
    backgroundColor: C.bg,
  },

  topBar: { height: 6, backgroundColor: C.brand, borderRadius: 6, marginBottom: 14 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },

  brandLeft: { flexDirection: "row", alignItems: "center", maxWidth: 380 },
  brandSpacer: { width: 12 },

  logo: { width: 128, height: 42, objectFit: "contain" },

  titleBlock: { flexDirection: "column" },
  title: { fontSize: 16, fontWeight: 700, letterSpacing: 0.2, color: C.ink },
  subtitle: { marginTop: 2, fontSize: 9, color: C.muted },

  badge: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: "#CFE2F1",
    fontSize: 8,
    color: C.brand,
    fontWeight: 700,
  },

  metaCard: {
    width: 245,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 10,
  },
  metaLabel: { fontSize: 8, color: C.muted },
  metaValue: { marginTop: 2, fontSize: 10, fontWeight: 700, color: C.ink },
  metaDivider: { height: 1, backgroundColor: C.line, marginVertical: 8 },

  hr: { height: 1, backgroundColor: C.line, marginBottom: 12 },

  kpiRow: { flexDirection: "row", marginBottom: 12 },
  kpiSpacer: { width: 10 },

  kpi: { flexGrow: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 },
  kpiLabel: { fontSize: 8, color: C.muted },
  kpiValue: { marginTop: 4, fontSize: 12, fontWeight: 700, color: C.ink },
  kpiHint: { marginTop: 3, fontSize: 8, color: C.muted },

  kpiTotal: { flexGrow: 1.3, backgroundColor: C.brand, borderRadius: 10, padding: 10 },
  kpiTotalLabel: { fontSize: 8, color: "#DCEAF6", fontWeight: 700 },
  kpiTotalValue: { marginTop: 4, fontSize: 14, fontWeight: 700, color: C.white },

  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginBottom: 12 },

  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sectionIndex: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: "#CFE2F1",
    color: C.brand,
    fontSize: 10,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 3,
  },
  sectionHeaderSpacer: { width: 8 },
  sectionTitle: { fontSize: 11.5, fontWeight: 700, color: C.ink },
  sectionSub: { marginTop: 2, fontSize: 8.5, color: C.muted },

  table: { borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  trHead: { flexDirection: "row", backgroundColor: C.head, borderBottomWidth: 1, borderBottomColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line },
  trAlt: { backgroundColor: C.altRow },
  th: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 8.5, fontWeight: 700, color: C.ink },
  td: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 9, color: C.ink },
  r: { textAlign: "right" },

  note: { marginTop: 8, fontSize: 9, color: C.ink },
  strong: { fontWeight: 700 },

  financeBox: {
    marginTop: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 10,
  },

  obsText: { fontSize: 9, color: C.ink, lineHeight: 1.35 },

  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
    fontSize: 8,
    color: C.muted,
  },

  // ===== Página 2: Fotos (layout fixo, 2 páginas sempre) =====
  photosTitle: { fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 10 },

  row: { flexDirection: "row" },
  rowMb: { marginBottom: 10 },

  photoHalfLeft: {
    width: "49%",
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
    marginRight: 10,
  },
  photoHalfRight: {
    width: "49%",
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
  },
  photoFull: {
    width: "100%" as any,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 8,
  },

  photoName: { fontSize: 9, fontWeight: 700, marginBottom: 6, color: C.ink },

  // chave: contain + height fixa (não corta / não estoura página)
  photoImgHalf: { width: "100%", height: 250, objectFit: "contain", borderRadius: 8 },
  photoImgFull: { width: "100%", height: 260, objectFit: "contain", borderRadius: 8 },

  photoMissing: {
    width: "100%",
    height: 250,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
  },
  photoMissingText: { fontSize: 8.5, color: C.muted },
});

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function leitura(v: number | null) {
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function imgDataUri(src: ImageSrcObj) {
  const mime = src.format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${src.data.toString("base64")}`;
}
function fmtDateTime(v?: string) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return String(v);
  }
}

function resolveLogoUri(logo?: Props["logo"]) {
  if (!logo) return null;
  if (typeof logo === "string") return logo;
  if ((logo as ImageSrcObj)?.data) return imgDataUri(logo as ImageSrcObj);
  return null;
}

function normTxt(s: string) {
  try {
    // remove acentos e normaliza
    return (s || "")
      .toString()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
  } catch {
    return (s || "").toString().toLowerCase().trim();
  }
}

function pickAnexo(anexos: AnexoPdf[], predicate: (tipoNorm: string) => boolean): AnexoPdf | null {
  for (const a of anexos) {
    if (!a) continue;
    if (!a.isImagem) continue;
    if (!a.src?.data) continue;
    const t = normTxt(a.tipo || "");
    if (predicate(t)) return a;
  }
  return null;
}

function PhotoBox(props: { label: string; item: AnexoPdf | null; full?: boolean }) {
  const { label, item, full } = props;
  const has = !!item?.src?.data;

  const boxStyle = full ? S.photoFull : null; // (vamos escolher fora por layout)
  const imgStyle = full ? S.photoImgFull : S.photoImgHalf;

  return (
    <View style={boxStyle ?? ({} as any)}>
      <Text style={S.photoName}>{label}</Text>
      {has ? (
        <Image src={imgDataUri(item!.src!)} style={imgStyle} />
      ) : (
        <View style={[S.photoMissing, full ? { height: 260 } : {}]}>
          <Text style={S.photoMissingText}>Sem foto</Text>
        </View>
      )}
    </View>
  );
}
        {/* Observações: só se existir (senão some) */}
        {obsCompact ? (
          <View style={[S.card, { marginBottom: 0 }]}>
            <View style={S.sectionHeader}>
              <Text style={S.sectionIndex}>4</Text>
              <View style={S.sectionHeaderSpacer} />
              <View>
                <Text style={S.sectionTitle}>Observações</Text>
                <Text style={S.sectionSub}>Notas do auditor / conferência</Text>
              </View>
            </View>
            <Text style={S.obsText}>{obsCompact}</Text>
          </View>
        ) : null}

        <View style={S.footer}>
          <Text>META LAV — Tecnologia em Lavanderia</Text>
          <Text>Competência {p.periodo || "—"}</Text>
        </View>
      </Page>

      {/* Página 2: Fotos (fixo, SEM 3ª página) */}
      <Page size="A4" style={S.page}>
        <View style={S.topBar} />

        <View style={S.headerRow}>
          <View style={S.brandLeft}>
            {logoUri ? <Image src={logoUri} style={S.logo} /> : null}
            <View style={S.brandSpacer} />
            <View style={S.titleBlock}>
              <Text style={S.title}>Anexos</Text>
              <Text style={S.subtitle}>Evidências do fechamento — {p.periodo || "—"}</Text>
              <Text style={S.badge}>EVIDÊNCIAS</Text>
            </View>
          </View>

          <View style={S.metaCard}>
            <Text style={S.metaLabel}>Condomínio</Text>
            <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>
            <View style={S.metaDivider} />
            <Text style={S.metaLabel}>Competência</Text>
            <Text style={S.metaValue}>{p.periodo || "—"}</Text>
          </View>
        </View>

        <View style={S.hr} />

        <Text style={S.photosTitle}>Fotos</Text>

        {temGas ? (
          <>
            <View style={[S.row, S.rowMb]}>
              <View style={S.photoHalfLeft}>
                <PhotoBox label="Medidor de Água" item={aAgua} />
              </View>
              <View style={S.photoHalfRight}>
                <PhotoBox label="Medidor de Energia" item={aEnergia} />
              </View>
            </View>

            <View style={S.row}>
              <View style={S.photoHalfLeft}>
                <PhotoBox label="Medidor de Gás" item={aGas} />
              </View>
              <View style={S.photoHalfRight}>
                <PhotoBox label="Comprovante de pagamento" item={aComprovante} />
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={[S.row, S.rowMb]}>
              <View style={S.photoHalfLeft}>
                <PhotoBox label="Medidor de Água" item={aAgua} />
              </View>
              <View style={S.photoHalfRight}>
                <PhotoBox label="Medidor de Energia" item={aEnergia} />
              </View>
            </View>

            <View style={S.photoFull}>
              <PhotoBox label="Comprovante de pagamento" item={aComprovante} full />
            </View>
          </>
        )}

        <View style={S.footer}>
          <Text>META LAV — Tecnologia em Lavanderia</Text>
          <Text>Competência {p.periodo || "—"}</Text>
        </View>
      </Page>
    </Document>
  );
}
