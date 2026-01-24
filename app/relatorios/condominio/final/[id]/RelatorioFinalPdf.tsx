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

  // Anexos (linhas variáveis, sem placeholders)
  anexoRow: { flexDirection: "row" },
  anexoRowSpacer: { height: 10 },
  anexoColSpacer: { width: 10 },

  anexoBox: { flexGrow: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8 },
  anexoName: { fontSize: 9, fontWeight: 700, marginBottom: 6, color: C.ink },
  anexoImg: { width: "100%", height: 240, objectFit: "cover", borderRadius: 8 },

  // quando só tem 1 item na linha, ele ocupa tudo
  anexoBoxFull: { width: "100%" as any },
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
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

function AnexoBox({ item, full }: { item: AnexoPdf; full?: boolean }) {
  return (
    <View style={[S.anexoBox, full ? S.anexoBoxFull : undefined]}>
      <Text style={S.anexoName}>{item.tipo}</Text>
      {item?.src?.data ? (
        <Image src={imgDataUri(item.src!)} style={S.anexoImg} />
      ) : (
        // sem “placeholder”; se não embutiu, fica só o título (melhor do que poluir)
        <Text style={{ fontSize: 8.5, color: C.muted }}>Anexo não incorporado no PDF.</Text>
      )}
    </View>
  );
}

export default function RelatorioFinalPdf(p: Props) {
  const logoUri = resolveLogoUri(p.logo);

  const obs = (p.observacoes || "").trim();
  const obsCompact = obs ? (obs.length > 260 ? obs.slice(0, 257) + "…" : obs) : "";

  // só anexos válidos (se vier vazio, some)
  const anexosValidos = (Array.isArray(p.anexos) ? p.anexos : []).filter(Boolean);
  // por página: até 4 itens (2 linhas de 2)
  const anexosPaginas = chunk(anexosValidos, 4);

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.topBar} />

        <View style={S.headerRow}>
          <View style={S.brandLeft}>
            {logoUri ? <Image src={logoUri} style={S.logo} /> : null}
            <View style={S.brandSpacer} />
            <View style={S.titleBlock}>
              <Text style={S.title}>Prestação de Contas</Text>
              <Text style={S.subtitle}>Lavanderia Compartilhada — Relatório final</Text>
              <Text style={S.badge}>DOCUMENTO OFICIAL</Text>
            </View>
          </View>

          <View style={S.metaCard}>
            <Text style={S.metaLabel}>Condomínio</Text>
            <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>

            <View style={S.metaDivider} />

            <Text style={S.metaLabel}>Competência</Text>
            <Text style={S.metaValue}>{p.periodo || "—"}</Text>

            <View style={S.metaDivider} />

            <Text style={S.metaLabel}>Gerado em</Text>
            <Text style={[S.metaValue, { fontSize: 9 }]}>{fmtDateTime(p.gerado_em)}</Text>

            {/* Forma de pagamento removida por requisito */}
          </View>
        </View>

        <View style={S.hr} />

        <View style={S.kpiRow}>
          <View style={S.kpi}>
            <Text style={S.kpiLabel}>Receita bruta</Text>
            <Text style={S.kpiValue}>{brl(p.kpis?.receita_bruta ?? 0)}</Text>
          </View>

          <View style={S.kpiSpacer} />

          <View style={S.kpi}>
            <Text style={S.kpiLabel}>Cashback</Text>
            <Text style={S.kpiValue}>{brl(p.kpis?.cashback_valor ?? 0)}</Text>
            <Text style={S.kpiHint}>{n(p.kpis?.cashback_percentual ?? 0)}% sobre receita</Text>
          </View>

          <View style={S.kpiSpacer} />

          <View style={S.kpi}>
            <Text style={S.kpiLabel}>Repasse de consumo (insumos)</Text>
            <Text style={S.kpiValue}>{brl(p.total_consumo ?? 0)}</Text>
          </View>

          <View style={S.kpiSpacer} />

          <View style={S.kpiTotal}>
            <Text style={S.kpiTotalLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
            <Text style={S.kpiTotalValue}>{brl(p.total_pagar ?? 0)}</Text>
          </View>
        </View>

        {/* 1 Vendas */}
        <View style={S.card}>
          <View style={S.sectionHeader}>
            <Text style={S.sectionIndex}>1</Text>
            <View style={S.sectionHeaderSpacer} />
            <View>
              <Text style={S.sectionTitle}>Vendas</Text>
              <Text style={S.sectionSub}>Vendas por máquina</Text>
            </View>
          </View>

          <View style={S.table}>
            <View style={S.trHead}>
              <Text style={[S.th, { width: "40%" }]}>Máquina</Text>
              <Text style={[S.th, { width: "15%" }, S.r]}>Ciclos</Text>
              <Text style={[S.th, { width: "20%" }, S.r]}>V. unit.</Text>
              <Text style={[S.th, { width: "25%" }, S.r]}>Receita</Text>
            </View>

            {(p.vendas || []).map((v, i) => (
              <View key={i} style={[S.tr, i % 2 === 1 ? S.trAlt : {}]} wrap={false}>
                <Text style={[S.td, { width: "40%" }]}>{v.maquina || "—"}</Text>
                <Text style={[S.td, { width: "15%" }, S.r]}>{n(v.ciclos)}</Text>
                <Text style={[S.td, { width: "20%" }, S.r]}>{brl(v.valor_unitario)}</Text>
                <Text style={[S.td, { width: "25%" }, S.r, { fontWeight: 700 }]}>{brl(v.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={S.note}>
            Receita bruta: <Text style={S.strong}>{brl(p.kpis?.receita_bruta ?? 0)}</Text> • Cashback:{" "}
            <Text style={S.strong}>{n(p.kpis?.cashback_percentual ?? 0)}%</Text> (
            <Text style={S.strong}>{brl(p.kpis?.cashback_valor ?? 0)}</Text>)
          </Text>
        </View>

        {/* 2 Insumos */}
        <View style={S.card}>
          <View style={S.sectionHeader}>
            <Text style={S.sectionIndex}>2</Text>
            <View style={S.sectionHeaderSpacer} />
            <View>
              <Text style={S.sectionTitle}>Insumos</Text>
              <Text style={S.sectionSub}>Leitura anterior, leitura atual, consumo e repasse</Text>
            </View>
          </View>

          <View style={S.table}>
            <View style={S.trHead}>
              <Text style={[S.th, { width: "26%" }]}>Insumo</Text>
              <Text style={[S.th, { width: "18%" }, S.r]}>Anterior</Text>
              <Text style={[S.th, { width: "18%" }, S.r]}>Atual</Text>
              <Text style={[S.th, { width: "14%" }, S.r]}>Consumo</Text>
              <Text style={[S.th, { width: "24%" }, S.r]}>Repasse</Text>
            </View>

            {(p.consumos || []).map((c, i) => (
              <View key={i} style={[S.tr, i % 2 === 1 ? S.trAlt : {}]} wrap={false}>
                <Text style={[S.td, { width: "26%" }]}>{c.nome || "—"}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.anterior)}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.atual)}</Text>
                <Text style={[S.td, { width: "14%" }, S.r]}>{n(c.consumo)}</Text>
                <Text style={[S.td, { width: "24%" }, S.r, { fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={S.note}>
            Total do repasse de consumo: <Text style={S.strong}>{brl(p.total_consumo ?? 0)}</Text>
          </Text>
        </View>

        {/* 3 Financeiro */}
        <View style={S.card}>
          <View style={S.sectionHeader}>
            <Text style={S.sectionIndex}>3</Text>
            <View style={S.sectionHeaderSpacer} />
            <View>
              <Text style={S.sectionTitle}>Financeiro</Text>
              <Text style={S.sectionSub}>Composição do valor final</Text>
            </View>
          </View>

          <View style={S.financeBox}>
            <Text style={S.note}>
              Cashback: <Text style={S.strong}>{brl(p.total_cashback ?? 0)}</Text>
            </Text>
            <Text style={S.note}>
              Repasse de consumo (insumos): <Text style={S.strong}>{brl(p.total_consumo ?? 0)}</Text>
            </Text>
            <Text style={[S.note, { marginTop: 10 }]}>
              Total a pagar ao condomínio: <Text style={[S.strong, { fontSize: 11 }]}>{brl(p.total_pagar ?? 0)}</Text>
            </Text>
          </View>
        </View>

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

      {/* Anexos — só se existir */}
      {anexosPaginas.map((items, pageIdx) => {
        // divide em linhas de 2
        const rows = chunk(items, 2);

        return (
          <Page key={pageIdx} size="A4" style={S.page}>
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

            {rows.map((r, idx) => {
              const a = r[0];
              const b = r[1];

              return (
                <View key={idx}>
                  <View style={S.anexoRow}>
                    {a ? <AnexoBox item={a} full={!b} /> : null}
                    {a && b ? <View style={S.anexoColSpacer} /> : null}
                    {b ? <AnexoBox item={b} /> : null}
                  </View>
                  {idx < rows.length - 1 ? <View style={S.anexoRowSpacer} /> : null}
                </View>
              );
            })}

            <View style={S.footer}>
              <Text>META LAV — Tecnologia em Lavanderia</Text>
              <Text>Competência {p.periodo || "—"}</Text>
            </View>
          </Page>
        );
      })}
    </Document>
  );
}
