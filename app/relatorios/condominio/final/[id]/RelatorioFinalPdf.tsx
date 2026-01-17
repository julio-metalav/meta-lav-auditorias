import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

type Props = {
  logo?: ImageSrcObj | null;

  condominio: { nome: string };
  periodo: string; // ex: 01/2026
  gerado_em?: string;

  vendas: Array<{
    maquina: string;
    ciclos: number;
    valor_unitario: number;
    valor_total: number;
  }>;

  kpis: {
    receita_bruta: number;
    cashback_percentual: number;
    cashback_valor: number;
  };

  consumos: Array<{
    nome: string;
    anterior: number;
    atual: number;
    consumo: number;
    valor_total: number;
  }>;

  total_consumo: number;
  total_cashback: number;
  total_pagar: number;

  observacoes?: string;
  anexos: AnexoPdf[];
};

/* ================= UTIL ================= */

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function leitura(v: any) {
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function img(src: ImageSrcObj) {
  const mime = src.format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${src.data.toString("base64")}`;
}
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function fmtDateTime(v?: string) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return String(v);
  }
}

/* ================= THEME ================= */
/**
 * Ajustei para um visual "banco":
 * - Top bar institucional
 * - Tipografia mais limpa
 * - Cards e tabelas com hierarquia
 * Obs: sem sombras (react-pdf é limitado), então usamos borda, padding e contraste.
 */
const C = {
  ink: "#0B1F35",
  muted: "#5B6B7E",
  line: "#D9E2EC",
  bg: "#F5F8FB",
  white: "#FFFFFF",
  // cor institucional (azul da marca “aproximado”)
  brand: "#0B4A78",
  // destaque “laranja” discreto (marca)
  accent: "#F59E0B",
};

const S = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 28,
    paddingBottom: 22,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: C.ink,
    backgroundColor: C.bg,
  },

  topBar: {
    height: 6,
    backgroundColor: C.brand,
    borderRadius: 6,
    marginBottom: 14,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },

  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    maxWidth: 360,
  },

  logo: {
    width: 132,
    height: 44,
    objectFit: "contain",
  },

  titleBlock: {
    flexDirection: "column",
  },

  docTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.ink,
    letterSpacing: 0.2,
  },

  docSub: {
    marginTop: 2,
    fontSize: 9.5,
    color: C.muted,
  },

  docTag: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#EAF2F8",
    borderWidth: 1,
    borderColor: "#CFE2F1",
    fontSize: 8.5,
    color: C.brand,
    fontWeight: 700,
  },

  metaCard: {
    width: 240,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 10,
  },

  metaLabel: {
    fontSize: 8,
    color: C.muted,
  },

  metaValue: {
    marginTop: 2,
    fontSize: 10.5,
    fontWeight: 700,
    color: C.ink,
  },

  metaDivider: {
    height: 1,
    backgroundColor: C.line,
    marginVertical: 8,
  },

  hr: {
    height: 2,
    backgroundColor: "#E6EEF6",
    borderRadius: 2,
    marginBottom: 14,
  },

  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

  sectionIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#EAF2F8",
    borderWidth: 1,
    borderColor: "#CFE2F1",
    color: C.brand,
    fontSize: 10,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 4,
  },

  sectionTitle: {
    fontSize: 12.5,
    fontWeight: 700,
    color: C.ink,
  },

  sectionSub: {
    marginTop: 2,
    fontSize: 9,
    color: C.muted,
  },

  table: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    overflow: "hidden",
  },

  trHead: {
    flexDirection: "row",
    backgroundColor: "#F2F6FA",
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  trAlt: {
    backgroundColor: "#FBFDFF",
  },

  th: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 9,
    fontWeight: 700,
    color: C.ink,
  },

  td: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 9.5,
    color: C.ink,
  },

  r: { textAlign: "right" },

  noteLine: {
    marginTop: 8,
    fontSize: 9.5,
    color: C.ink,
  },

  noteStrong: { fontWeight: 700 },

  totalCard: {
    backgroundColor: C.brand,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },

  totalLabel: {
    fontSize: 9,
    color: "#DCEAF6",
    fontWeight: 700,
    letterSpacing: 0.2,
  },

  totalValue: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: 700,
    color: C.white,
  },

  obsText: {
    fontSize: 9.5,
    color: C.ink,
    lineHeight: 1.35,
  },

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

  /* ANEXOS */
  anexoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },

  anexoTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.ink,
  },

  anexoCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 10,
    marginBottom: 12,
  },

  anexoName: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
    color: C.ink,
  },

  anexoImg: {
    width: "100%",
    height: 310,
    objectFit: "contain",
  },

  badge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    color: "#9A3412",
    fontSize: 8.5,
    fontWeight: 700,
  },
});

/* ================= PDF ================= */

export default function RelatorioFinalPdf(p: Props) {
  const logoUri = p.logo?.data ? img(p.logo) : null;
  const obs = (p.observacoes || "").trim();
  const obsCompact = obs ? (obs.length > 260 ? obs.slice(0, 257) + "…" : obs) : "—";

  return (
    <Document>
      {/* ================= PAGE 1 ================= */}
      <Page size="A4" style={S.page}>
        <View style={S.topBar} />

        <View style={S.headerRow}>
          <View style={S.brandBlock}>
            {logoUri ? <Image src={logoUri} style={S.logo} /> : null}

            <View style={S.titleBlock}>
              <Text style={S.docTitle}>Prestação de Contas</Text>
              <Text style={S.docSub}>Lavanderia Compartilhada — Relatório final</Text>
              <Text style={S.docTag}>DOCUMENTO OFICIAL</Text>
            </View>
          </View>

          <View style={S.metaCard}>
            <Text style={S.metaLabel}>Condomínio</Text>
            <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>

            <View style={S.metaDivider} />

            <Text style={S.metaLabel}>Competência</Text>
            <Text style={S.metaValue}>{p.periodo || "—"}</Text>

            {p.gerado_em ? (
              <>
                <View style={S.metaDivider} />
                <Text style={S.metaLabel}>Gerado em</Text>
                <Text style={[S.metaValue, { fontSize: 9.5 }]}>{fmtDateTime(p.gerado_em)}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={S.hr} />

        {/* 1. VENDAS */}
        <View style={S.card}>
          <View style={S.sectionTitleRow}>
            <Text style={S.sectionIndex}>1</Text>
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

            {p.vendas.map((v, i) => (
              <View key={i} style={[S.tr, i % 2 === 1 ? S.trAlt : null]} wrap={false}>
                <Text style={[S.td, { width: "40%" }]}>{v.maquina || "—"}</Text>
                <Text style={[S.td, { width: "15%" }, S.r]}>{n(v.ciclos)}</Text>
                <Text style={[S.td, { width: "20%" }, S.r]}>{brl(v.valor_unitario)}</Text>
                <Text style={[S.td, { width: "25%" }, S.r, { fontWeight: 700 }]}>{brl(v.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={S.noteLine}>
            Receita bruta: <Text style={S.noteStrong}>{brl(p.kpis.receita_bruta)}</Text>{" "}
            · Cashback: <Text style={S.noteStrong}>{n(p.kpis.cashback_percentual)}%</Text>{" "}
            (<Text style={S.noteStrong}>{brl(p.kpis.cashback_valor)}</Text>)
          </Text>
        </View>

        {/* 2. INSUMOS */}
        <View style={S.card}>
          <View style={S.sectionTitleRow}>
            <Text style={S.sectionIndex}>2</Text>
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

            {p.consumos.map((c, i) => (
              <View key={i} style={[S.tr, i % 2 === 1 ? S.trAlt : null]} wrap={false}>
                <Text style={[S.td, { width: "26%" }]}>{c.nome || "—"}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.anterior)}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.atual)}</Text>
                <Text style={[S.td, { width: "14%" }, S.r]}>{n(c.consumo)}</Text>
                <Text style={[S.td, { width: "24%" }, S.r, { fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={S.noteLine}>
            Total do repasse de consumo: <Text style={S.noteStrong}>{brl(p.total_consumo)}</Text>
          </Text>
        </View>

        {/* 3. FINANCEIRO */}
        <View style={S.card}>
          <View style={S.sectionTitleRow}>
            <Text style={S.sectionIndex}>3</Text>
            <View>
              <Text style={S.sectionTitle}>Financeiro</Text>
              <Text style={S.sectionSub}>Consolidação final do mês</Text>
            </View>
          </View>

          <Text style={S.noteLine}>
            Cashback: <Text style={S.noteStrong}>{brl(p.total_cashback)}</Text>{" "}
            · Repasse de consumo: <Text style={S.noteStrong}>{brl(p.total_consumo)}</Text>
          </Text>

          <View style={S.totalCard}>
            <Text style={S.totalLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
            <Text style={S.totalValue}>{brl(p.total_pagar)}</Text>
            <Text style={S.badge}>PAGAMENTO A PROGRAMAR / CONFERIR</Text>
          </View>
        </View>

        {/* 4. OBS */}
        <View style={S.card}>
          <View style={S.sectionTitleRow}>
            <Text style={S.sectionIndex}>4</Text>
            <View>
              <Text style={S.sectionTitle}>Observações</Text>
              <Text style={S.sectionSub}>Notas do auditor / conferência</Text>
            </View>
          </View>

          <Text style={S.obsText}>{obsCompact}</Text>
        </View>

        <View style={S.footer}>
          <Text>META LAV — Tecnologia em Lavanderia</Text>
          <Text>Competência {p.periodo || "—"}</Text>
        </View>
      </Page>

      {/* ================= ANEXOS (2 POR PÁGINA) ================= */}
      {chunk(p.anexos || [], 2).map((pair, i) => (
        <Page key={i} size="A4" style={S.page}>
          <View style={S.topBar} />

          <View style={S.anexoHeader}>
            <View style={S.brandBlock}>
              {logoUri ? <Image src={logoUri} style={S.logo} /> : null}
              <View style={S.titleBlock}>
                <Text style={S.anexoTitle}>Anexos</Text>
                <Text style={S.docSub}>Evidências do fechamento — {p.periodo || "—"}</Text>
                <Text style={S.docTag}>EVIDÊNCIAS</Text>
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

          {pair.map((a, j) => (
            <View key={j} style={S.anexoCard}>
              <Text style={S.anexoName}>{a.tipo}</Text>
              {a?.src?.data ? (
                <Image src={img(a.src)} style={S.anexoImg} />
              ) : (
                <Text style={{ fontSize: 9, color: C.muted }}>
                  Não foi possível incorporar este anexo no PDF.
                </Text>
              )}
            </View>
          ))}

          <View style={S.footer}>
            <Text>META LAV — Tecnologia em Lavanderia</Text>
            <Text>Competência {p.periodo || "—"}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}
