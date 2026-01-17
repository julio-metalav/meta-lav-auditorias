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
 * Visual Passo 1 (hierarquia):
 * - Cabeçalho corporativo
 * - Seções em "cards"
 * - Tabelas mais legíveis
 * - Destaque forte do TOTAL A PAGAR
 * - Sem mexer em regras, dados ou rotas
 *
 * Build-safe:
 * - Nenhum boolean em style[]
 * - Tipagem compatível com react-pdf
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
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>META LAV</Text>
            <Text style={styles.reportTitle}>Prestação de Contas</Text>
            <Text style={styles.reportSubtitle}>Lavanderia Compartilhada</Text>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.metaLabel}>Condomínio</Text>
            <Text style={styles.metaValue}>{condominio.nome}</Text>

            <View style={styles.metaSpacer} />

            <Text style={styles.metaLabel}>Competência</Text>
            <Text style={styles.metaValue}>{periodo}</Text>
          </View>
        </View>

        <View style={styles.headerDivider} />

        {/* RESUMO */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Resumo executivo</Text>
          <Text style={styles.summaryText}>
            Este relatório consolida vendas por máquina, cashback e repasse de
            consumo (água/energia/gás, quando aplicável), apurados na auditoria
            finalizada.
          </Text>
        </View>

        {/* VENDAS */}
        <Section
          index="1"
          title="Vendas por máquina"
          subtitle="Fechamento de caixa por equipamento e ciclos"
        >
          <Table>
            <HeaderRow
              cols={["Máquina", "Ciclos", "Valor unitário", "Valor total"]}
              align={["left", "right", "right", "right"]}
            />

            {vendas.map((v, i) => {
              const values = [
                v.maquina,
                v.ciclos.toString(),
                money(v.valor_unitario),
                money(v.valor_total),
              ];

              if (i === 0) return <Row key={i} values={values} align={["left", "right", "right", "right"]} />;

              // alternância visual sem colocar boolean em style[]
              if (i % 2 === 1) {
                return (
                  <RowWithBorderAlt
                    key={i}
                    values={values}
                    align={["left", "right", "right", "right"]}
                  />
                );
              }
              return (
                <RowWithBorder
                  key={i}
                  values={values}
                  align={["left", "right", "right", "right"]}
                />
              );
            })}
          </Table>

          <View style={styles.kpiGrid}>
            <KpiCard label="Receita bruta total" value={money(kpis.receita_bruta)} />
            <KpiCard
              label={`Cashback (${kpis.cashback_percentual}%)`}
              value={money(kpis.cashback_valor)}
            />
          </View>
        </Section>

        {/* CONSUMO */}
        <Section
          index="2"
          title="Consumo de insumos"
          subtitle="Leituras, consumo apurado e repasse"
        >
          <Table>
            <HeaderRow
              cols={[
                "Insumo",
                "Anterior",
                "Atual",
                "Consumo",
                "Valor unit.",
                "Valor total",
              ]}
              align={["left", "right", "right", "right", "right", "right"]}
            />

            {consumos.map((c, i) => {
              const values = [
                c.nome,
                c.anterior.toString(),
                c.atual.toString(),
                c.consumo.toString(),
                money(c.valor_unitario),
                money(c.valor_total),
              ];

              if (i === 0) {
                return (
                  <Row
                    key={i}
                    values={values}
                    align={["left", "right", "right", "right", "right", "right"]}
                  />
                );
              }

              if (i % 2 === 1) {
                return (
                  <RowWithBorderAlt
                    key={i}
                    values={values}
                    align={["left", "right", "right", "right", "right", "right"]}
                  />
                );
              }

              return (
                <RowWithBorder
                  key={i}
                  values={values}
                  align={["left", "right", "right", "right", "right", "right"]}
                />
              );
            })}
          </Table>

          <View style={styles.kpiSingle}>
            <KpiLineStrong label="Total do repasse de consumo" value={money(total_consumo)} />
          </View>
        </Section>

        {/* TOTALIZAÇÃO */}
        <Section
          index="3"
          title="Totalização final"
          subtitle="Número principal do relatório"
        >
          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Cashback</Text>
              <Text style={styles.totalValue}>{money(total_cashback)}</Text>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Repasse de consumo</Text>
              <Text style={styles.totalValue}>{money(total_consumo)}</Text>
            </View>

            <View style={styles.totalDivider} />

            <View style={styles.totalHighlight}>
              <Text style={styles.totalHighlightLabel}>
                TOTAL A PAGAR AO CONDOMÍNIO
              </Text>
              <Text style={styles.totalHighlightValue}>{money(total_pagar)}</Text>
            </View>

            <Text style={styles.totalHint}>
              Valor consolidado a partir das vendas por máquina, cashback e repasse de consumo.
            </Text>
          </View>
        </Section>

        {/* OBSERVAÇÕES */}
        {observacoes && (
          <Section index="4" title="Observações" subtitle="Notas adicionais do fechamento">
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>{observacoes}</Text>
            </View>
          </Section>
        )}

        {/* FOOTER */}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Meta Lav Auditorias • Página ${pageNumber} de ${totalPages}`
          }
        />
      </Page>

      {/* ===================== PÁGINA 2 ===================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerSimple}>
          <View>
            <Text style={styles.brand}>META LAV</Text>
            <Text style={styles.pageTitle}>Anexos</Text>
            <Text style={styles.pageSubtitle}>
              Evidências fotográficas e comprovantes vinculados à auditoria.
            </Text>
          </View>
          <View style={styles.headerRightSimple}>
            <Text style={styles.metaLabel}>Condomínio</Text>
            <Text style={styles.metaValue}>{condominio.nome}</Text>
            <View style={styles.metaSpacer} />
            <Text style={styles.metaLabel}>Competência</Text>
            <Text style={styles.metaValue}>{periodo}</Text>
          </View>
        </View>

        <View style={styles.headerDivider} />

        <View style={styles.grid}>
          {anexos.map((a, i) => {
            if (a.isImagem && a.url) {
              return (
                <View key={i} style={styles.imageCard}>
                  <Text style={styles.imageLabel}>{a.tipo}</Text>
                  <View style={styles.imageFrame}>
                    <Image src={a.url} style={styles.image} />
                  </View>
                </View>
              );
            }

            return (
              <View key={i} style={styles.nonImageCard}>
                <Text style={styles.nonImageTitle}>{a.tipo}</Text>
                <Text style={styles.nonImageText}>Anexo não é imagem.</Text>
              </View>
            );
          })}
        </View>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Meta Lav Auditorias • Página ${pageNumber} de ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

/* ===================== COMPONENTES ===================== */

function Section({
  index,
  title,
  subtitle,
  children,
}: {
  index: string;
  title: string;
  subtitle: string;
  children: any;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionBadge}>
          <Text style={styles.sectionBadgeText}>{index}</Text>
        </View>
        <View style={styles.sectionTitles}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Table({ children }: { children: any }) {
  return <View style={styles.table}>{children}</View>;
}

function HeaderRow({
  cols,
  align,
}: {
  cols: string[];
  align: Array<"left" | "right">;
}) {
  return (
    <View style={styles.trHeader}>
      {cols.map((c, i) => {
        const a = align[i] === "right" ? styles.thRight : styles.thLeft;
        return (
          <Text key={i} style={[styles.th, a]}>
            {c}
          </Text>
        );
      })}
    </View>
  );
}

function Row({
  values,
  align,
}: {
  values: string[];
  align: Array<"left" | "right">;
}) {
  return (
    <View style={styles.tr}>
      {values.map((v, i) => {
        const a = align[i] === "right" ? styles.tdRight : styles.tdLeft;
        return (
          <Text key={i} style={[styles.td, a]}>
            {v}
          </Text>
        );
      })}
    </View>
  );
}

function RowWithBorder({
  values,
  align,
}: {
  values: string[];
  align: Array<"left" | "right">;
}) {
  return (
    <View style={styles.trBorder}>
      {values.map((v, i) => {
        const a = align[i] === "right" ? styles.tdRight : styles.tdLeft;
        return (
          <Text key={i} style={[styles.td, a]}>
            {v}
          </Text>
        );
      })}
    </View>
  );
}

function RowWithBorderAlt({
  values,
  align,
}: {
  values: string[];
  align: Array<"left" | "right">;
}) {
  return (
    <View style={styles.trBorderAlt}>
      {values.map((v, i) => {
        const a = align[i] === "right" ? styles.tdRight : styles.tdLeft;
        return (
          <Text key={i} style={[styles.td, a]}>
            {v}
          </Text>
        );
      })}
    </View>
  );
}

/* ===================== KPI ===================== */

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

function KpiLineStrong({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiLineStrong}>
      <Text style={styles.kpiLineLabel}>{label}</Text>
      <Text style={styles.kpiLineValue}>{value}</Text>
    </View>
  );
}

/* ===================== HELPERS ===================== */

function money(v: number) {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 42,
    paddingHorizontal: 34,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },

  /* Header */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: { width: "58%" },
  headerRight: {
    width: "38%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#F9FAFB",
  },

  headerSimple: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerRightSimple: {
    width: "38%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#F9FAFB",
  },

  brand: { fontSize: 10, fontWeight: "bold", letterSpacing: 0.6, color: "#0F172A" },

  reportTitle: { fontSize: 18, fontWeight: "bold", marginTop: 6, color: "#0F172A" },
  reportSubtitle: { fontSize: 10, marginTop: 2, color: "#475569" },

  pageTitle: { fontSize: 16, fontWeight: "bold", marginTop: 6, color: "#0F172A" },
  pageSubtitle: { fontSize: 10, marginTop: 2, color: "#475569" },

  metaLabel: { fontSize: 9, color: "#6B7280" },
  metaValue: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  metaSpacer: { height: 8 },

  headerDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginTop: 14,
    marginBottom: 12,
  },

  /* Summary */
  summaryCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },
  summaryTitle: { fontSize: 11, fontWeight: "bold", color: "#0F172A" },
  summaryText: { fontSize: 9.5, marginTop: 4, color: "#475569", lineHeight: 1.35 },

  /* Section cards */
  sectionCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  sectionBadge: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: "#111827",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  sectionBadgeText: { fontSize: 9, fontWeight: "bold", color: "#FFFFFF" },

  sectionTitles: { flexGrow: 1 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: "#0F172A" },
  sectionSubtitle: { fontSize: 9, marginTop: 2, color: "#64748B" },

  sectionBody: { marginTop: 10 },

  /* Table */
  table: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 10,
  },

  trHeader: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderBottomWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  th: { flex: 1, fontSize: 9, fontWeight: "bold", color: "#334155" },
  thLeft: { textAlign: "left" },
  thRight: { textAlign: "right" },

  tr: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: "#FFFFFF",
  },
  trBorder: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  trBorderAlt: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FAFAFA",
  },

  td: { flex: 1, fontSize: 10, color: "#111827" },
  tdLeft: { textAlign: "left" },
  tdRight: { textAlign: "right" },

  /* KPI */
  kpiGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  kpiCard: {
    width: "49%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#F9FAFB",
  },
  kpiLabel: { fontSize: 9, color: "#6B7280" },
  kpiValue: { fontSize: 12, fontWeight: "bold", marginTop: 4, color: "#0F172A" },

  kpiSingle: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#F9FAFB",
  },
  kpiLineStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  kpiLineLabel: { fontSize: 10, fontWeight: "bold", color: "#0F172A" },
  kpiLineValue: { fontSize: 12, fontWeight: "bold", color: "#0F172A" },

  /* Total box */
  totalBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#F9FAFB",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: { fontSize: 10, color: "#334155" },
  totalValue: { fontSize: 10, fontWeight: "bold", color: "#0F172A" },

  totalDivider: { height: 1, backgroundColor: "#E5E7EB", marginVertical: 8 },

  totalHighlight: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#111827",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  totalHighlightLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  totalHighlightValue: { fontSize: 14, fontWeight: "bold", color: "#FFFFFF" },
  totalHint: { fontSize: 8.8, color: "#64748B", marginTop: 8, lineHeight: 1.25 },

  /* Notes */
  noteBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#FFFFFF",
  },
  noteText: { fontSize: 10, color: "#0F172A", lineHeight: 1.35 },

  /* Anexos */
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  imageCard: {
    width: "49%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },
  imageLabel: { fontSize: 9, fontWeight: "bold", color: "#0F172A", marginBottom: 6 },

  imageFrame: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 6,
    backgroundColor: "#F9FAFB",
  },
  image: {
    width: "100%",
    height: 220,
    objectFit: "contain",
  },

  nonImageCard: {
    width: "49%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },
  nonImageTitle: { fontSize: 9, fontWeight: "bold", color: "#0F172A" },
  nonImageText: { fontSize: 9, color: "#64748B", marginTop: 4 },

  /* Footer */
  footer: {
    position: "absolute",
    left: 34,
    right: 34,
    bottom: 18,
    fontSize: 9,
    color: "#9CA3AF",
    textAlign: "center",
  },
});
