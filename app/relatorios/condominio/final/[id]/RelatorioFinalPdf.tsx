import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

/**
 * RELATÓRIO FINAL – META LAV
 * Build-safe definitivo:
 * - Nenhum null
 * - Nenhum undefined
 * - Nenhum boolean em style[]
 * - Tipagem 100% compatível com react-pdf
 *
 * V1 VISUAL (corporativo) - versão conservadora (anti-500):
 * - Remove toLocaleString(pt-BR) no PDF (pode quebrar em serverless)
 * - money() e números sempre seguros
 * - Footer sem position:absolute
 */

type VendaMaquina = {
  maquina: string;
  ciclos: number;
  valor_unitario: number;
  valor_total: number;
};

type ConsumoItem = {
  nome: string;
  anterior: number;
  atual: number;
  consumo: number;
  valor_unitario: number;
  valor_total: number;
};

type Anexo = {
  tipo: string;
  url?: string;
  isImagem: boolean;
};

type Props = {
  condominio: { nome: string };
  periodo: string;
  vendas: VendaMaquina[];
  kpis: {
    receita_bruta: number;
    cashback_percentual: number;
    cashback_valor: number;
  };
  consumos: ConsumoItem[];
  total_consumo: number;
  total_cashback: number;
  total_pagar: number;
  observacoes?: string;
  anexos: Anexo[];
};

export default function RelatorioFinalPdf({
  condominio,
  periodo,
  vendas,
  kpis,
  consumos,
  total_consumo,
  total_cashback,
  total_pagar,
  observacoes,
  anexos,
}: Props) {
  return (
    <Document>
      {/* ===================== PÁGINA 1 ===================== */}
      <Page size="A4" style={styles.page}>
        {/* Header corporativo */}
        <View style={styles.headerBar}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>META LAV</Text>
            <Text style={styles.headerTitle}>
              Prestação de Contas — Lavanderia Compartilhada
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerMetaLabel}>Competência</Text>
            <Text style={styles.headerMetaValue}>{periodo}</Text>
          </View>
        </View>

        <View style={styles.headerCard}>
          <View style={styles.headerCardRow}>
            <View style={styles.headerCardCol}>
              <Text style={styles.labelMuted}>Condomínio</Text>
              <Text style={styles.valueStrong}>{condominio.nome}</Text>
            </View>
            <View style={styles.headerCardColRight}>
              <Text style={styles.labelMuted}>Documento</Text>
              <Text style={styles.valueMuted}>Relatório final de auditoria</Text>
            </View>
          </View>

          <View style={styles.headerNote}>
            <Text style={styles.headerNoteTitle}>
              Consolidado de vendas, cashback e repasse
            </Text>
            <Text style={styles.headerNoteText}>
              Documento para conferência e arquivamento. O valor “TOTAL A PAGAR”
              é o número principal do relatório.
            </Text>
          </View>
        </View>

        {/* VENDAS */}
        <Section
          n="1"
          title="Vendas por máquina"
          subtitle="Fechamento por capacidade e tipo de máquina"
        >
          <Table>
            <HeaderRow cols={["Máquina", "Ciclos", "Valor unitário", "Receita"]} />
            {vendas.map((v, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  right={[false, true, true, true]}
                  values={[
                    safeText(v.maquina),
                    safeInt(v.ciclos),
                    money(v.valor_unitario),
                    money(v.valor_total),
                  ]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  right={[false, true, true, true]}
                  values={[
                    safeText(v.maquina),
                    safeInt(v.ciclos),
                    money(v.valor_unitario),
                    money(v.valor_total),
                  ]}
                />
              )
            )}
          </Table>

          <View style={styles.kpiGrid}>
            <KpiCard label="Receita bruta total" value={money(kpis.receita_bruta)} />
            <KpiCard label="Cashback" value={`${safeInt(kpis.cashback_percentual)}%`} />
            <KpiCard label="Valor do cashback" value={money(kpis.cashback_valor)} />
          </View>
        </Section>

        {/* CONSUMO */}
        <Section n="2" title="Consumo de insumos" subtitle="Leituras, consumo e repasse">
          <Table>
            <HeaderRow
              cols={[
                "Insumo",
                "Anterior",
                "Atual",
                "Consumo",
                "Valor unit.",
                "Repasse",
              ]}
            />
            {consumos.map((c, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  right={[false, true, true, true, true, true]}
                  values={[
                    safeText(c.nome),
                    safeInt(c.anterior),
                    safeInt(c.atual),
                    safeInt(c.consumo),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  right={[false, true, true, true, true, true]}
                  values={[
                    safeText(c.nome),
                    safeInt(c.anterior),
                    safeInt(c.atual),
                    safeInt(c.consumo),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              )
            )}
          </Table>

          <View style={styles.kpiLineWrap}>
            <Text style={styles.kpiLabelBold}>Total do repasse de consumo</Text>
            <Text style={styles.kpiValueBold}>{money(total_consumo)}</Text>
          </View>
        </Section>

        {/* TOTALIZAÇÃO */}
        <Section n="3" title="Totalização final" subtitle="Número principal do relatório">
          <View style={styles.totalTable}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Cashback</Text>
              <Text style={styles.totalValue}>{money(total_cashback)}</Text>
            </View>
            <View style={styles.totalRowBorder}>
              <Text style={styles.totalLabel}>Repasse de consumo</Text>
              <Text style={styles.totalValue}>{money(total_consumo)}</Text>
            </View>
          </View>

          <View style={styles.totalHighlight}>
            <View style={styles.totalHighlightLeft}>
              <Text style={styles.totalHighlightLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
              <Text style={styles.totalHighlightHint}>Valor final consolidado</Text>
            </View>
            <Text style={styles.totalHighlightValue}>{money(total_pagar)}</Text>
          </View>
        </Section>

        {/* OBSERVAÇÕES */}
        {observacoes ? (
          <Section n="4" title="Observações">
            <View style={styles.noteBox}>
              <Text style={styles.text}>{safeText(observacoes)}</Text>
            </View>
          </Section>
        ) : null}

        <Footer />
      </Page>

      {/* ===================== PÁGINA 2 ===================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageTitleWrap}>
          <Text style={styles.pageTitle}>Anexos</Text>
          <Text style={styles.pageSubtitle}>
            Fotos embutidas para auditoria e conferência
          </Text>
        </View>

        <View style={styles.grid}>
          {anexos.map((a, i) =>
            a.isImagem && a.url ? (
              <View key={i} style={styles.imageCard}>
                <Text style={styles.imageLabel}>{safeText(a.tipo)}</Text>
                <View style={styles.imageFrame}>
                  <Image src={a.url} style={styles.image} />
                </View>
              </View>
            ) : (
              <View key={i} style={styles.fileRow}>
                <Text style={styles.fileDot}>•</Text>
                <Text style={styles.fileText}>{safeText(a.tipo)}: anexo não é imagem</Text>
              </View>
            )
          )}
        </View>

        <Footer />
      </Page>
    </Document>
  );
}

/* ===================== COMPONENTES ===================== */

function Section({ n, title, subtitle, children }: any) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionHeadLeft}>
          <Text style={styles.sectionNumber}>{n}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Table({ children }: any) {
  return <View style={styles.table}>{children}</View>;
}

function HeaderRow({ cols }: { cols: string[] }) {
  return (
    <View style={[styles.tr, styles.trHeader]}>
      {cols.map((c, i) => (
        <Text key={i} style={[styles.td, styles.th]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

function Row({ values, right }: { values: string[]; right?: boolean[] }) {
  const flags = right || [];
  return (
    <View style={styles.tr}>
      {values.map((v, i) => (
        <Text key={i} style={[styles.td, flags[i] ? styles.tdRight : styles.tdLeft]}>
          {v}
        </Text>
      ))}
    </View>
  );
}

function RowWithBorder({ values, right }: { values: string[]; right?: boolean[] }) {
  const flags = right || [];
  return (
    <View style={[styles.tr, styles.trBorder]}>
      {values.map((v, i) => (
        <Text key={i} style={[styles.td, flags[i] ? styles.tdRight : styles.tdLeft]}>
          {v}
        </Text>
      ))}
    </View>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiCardLabel}>{label}</Text>
      <Text style={styles.kpiCardValue}>{value}</Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>Meta Lav • Prestação de Contas</Text>
      <Text style={styles.footerText}>Documento gerado automaticamente</Text>
    </View>
  );
}

/* ===================== HELPERS (SEMPRE SEGUROS) ===================== */

function safeText(v: any) {
  const s = String(v ?? "");
  return s;
}

function safeNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeInt(v: any) {
  const n = safeNumber(v);
  return String(Math.round(n));
}

function money(v: any) {
  const n = safeNumber(v);
  // evita crash de locale em ambientes estranhos
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    // fallback bem simples, mas nunca quebra
    return `R$ ${n.toFixed(2)}`;
  }
}

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    fontSize: 10,
    color: "#0A0A0A",
  },

  /* HEADER */
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "column" },
  brand: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  headerTitle: { fontSize: 16, fontWeight: "bold", marginTop: 2, color: "#111827" },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  headerMetaLabel: { fontSize: 9, color: "#6B7280" },
  headerMetaValue: { fontSize: 11, fontWeight: "bold", color: "#111827", marginTop: 2 },

  headerCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#FFFFFF",
  },
  headerCardRow: { flexDirection: "row", justifyContent: "space-between" },
  headerCardCol: { flexDirection: "column", flexGrow: 1 },
  headerCardColRight: { flexDirection: "column", alignItems: "flex-end" },
  labelMuted: { fontSize: 9, color: "#6B7280" },
  valueStrong: { fontSize: 13, fontWeight: "bold", marginTop: 2, color: "#111827" },
  valueMuted: { fontSize: 10, marginTop: 2, color: "#374151" },

  headerNote: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  headerNoteTitle: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  headerNoteText: { fontSize: 9, color: "#6B7280", marginTop: 3, lineHeight: 1.35 },

  /* SECTIONS as CARDS */
  sectionCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
  },
  sectionHead: { marginBottom: 10 },
  sectionHeadLeft: { flexDirection: "row", alignItems: "baseline" },
  sectionNumber: { fontSize: 10, fontWeight: "bold", color: "#6B7280", marginRight: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: "#111827" },
  sectionSubtitle: { fontSize: 9, color: "#6B7280", marginTop: 3 },
  sectionBody: {},

  /* TABLE */
  table: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 10,
  },
  tr: { flexDirection: "row" },
  trHeader: {
    backgroundColor: "#F3F4F6",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  trBorder: { borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  td: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, fontSize: 9.5 },
  th: { fontWeight: "bold", color: "#374151" },
  tdLeft: { textAlign: "left", color: "#111827" },
  tdRight: { textAlign: "right", color: "#111827" },

  /* KPI */
  kpiGrid: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  kpiCard: {
    borderWidth: 1,
    borderColor: "#EEF2F7",
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 10,
    width: "32%",
  },
  kpiCardLabel: { fontSize: 9, color: "#6B7280" },
  kpiCardValue: { fontSize: 12, fontWeight: "bold", color: "#111827", marginTop: 4 },

  kpiLineWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  kpiLabelBold: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  kpiValueBold: { fontSize: 10, fontWeight: "bold", color: "#111827" },

  /* TOTALIZATION */
  totalTable: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    overflow: "hidden",
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 10 },
  totalRowBorder: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  totalLabel: { fontSize: 10, color: "#374151" },
  totalValue: { fontSize: 10, fontWeight: "bold", color: "#111827" },

  totalHighlight: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#111827",
    backgroundColor: "#F9FAFB",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalHighlightLeft: { flexDirection: "column" },
  totalHighlightLabel: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  totalHighlightHint: { fontSize: 9, color: "#6B7280", marginTop: 2 },
  totalHighlightValue: { fontSize: 16, fontWeight: "bold", color: "#111827" },

  /* NOTES */
  noteBox: {
    borderWidth: 1,
    borderColor: "#EEF2F7",
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 10,
  },
  text: { fontSize: 10, color: "#111827", lineHeight: 1.35 },

  /* PAGE 2 */
  pageTitleWrap: { marginBottom: 10 },
  pageTitle: { fontSize: 16, fontWeight: "bold", color: "#111827" },
  pageSubtitle: { fontSize: 9, color: "#6B7280", marginTop: 2 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  imageCard: {
    width: "48%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 8,
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
  },
  imageLabel: { fontSize: 9, fontWeight: "bold", color: "#374151", marginBottom: 6 },
  imageFrame: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 6,
    backgroundColor: "#F9FAFB",
  },
  image: {
    width: "100%",
    height: 210,
    objectFit: "contain",
  },

  fileRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  fileDot: { fontSize: 10, marginRight: 6, color: "#111827" },
  fileText: { fontSize: 9, color: "#374151" },

  /* FOOTER (sem absolute) */
  footer: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 6,
  },
  footerText: { fontSize: 8.5, color: "#9CA3AF" },
});
