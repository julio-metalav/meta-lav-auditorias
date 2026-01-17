import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

/**
 * RELATÓRIO FINAL – META LAV
 * Build-safe:
 * - Nenhum null/undefined/boolean em style[]
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

type ImageSrcObj = { data: any; format: "png" | "jpg" };

type Anexo = {
  tipo: string;
  src?: ImageSrcObj;
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
  const anexosImagem = anexos.filter((a) => a.isImagem && a.src);

  return (
    <Document>
      {/* ===================== PÁGINA 1 ===================== */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Relatório Mensal – Meta Lav</Text>
        <Text style={styles.subtitle}>
          Condomínio: {condominio.nome}{"\n"}Período: {periodo}
        </Text>

        {/* VENDAS */}
        <Section title="Vendas por Máquina">
          <Table>
            <HeaderRow cols={["Máquina", "Ciclos", "Valor unitário", "Valor total"]} />
            {vendas.map((v, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  values={[v.maquina, String(v.ciclos), money(v.valor_unitario), money(v.valor_total)]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  values={[v.maquina, String(v.ciclos), money(v.valor_unitario), money(v.valor_total)]}
                />
              )
            )}
          </Table>

          <KpiNormal label="Receita Bruta Total" value={money(kpis.receita_bruta)} />
          <KpiNormal label={`Cashback (${kpis.cashback_percentual}%)`} value={money(kpis.cashback_valor)} />
        </Section>

        {/* CONSUMO */}
        <Section title="Consumo de Insumos">
          <Table>
            <HeaderRow cols={["Insumo", "Anterior", "Atual", "Consumo", "Valor unit.", "Valor total"]} />
            {consumos.map((c, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  values={[
                    c.nome,
                    String(c.anterior),
                    String(c.atual),
                    String(c.consumo),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  values={[
                    c.nome,
                    String(c.anterior),
                    String(c.atual),
                    String(c.consumo),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              )
            )}
          </Table>

          <KpiBold label="Total do repasse de consumo" value={money(total_consumo)} />
        </Section>

        {/* TOTALIZAÇÃO */}
        <Section title="Totalização Final">
          <KpiNormal label="Cashback" value={money(total_cashback)} />
          <KpiNormal label="Repasse de consumo" value={money(total_consumo)} />
          <KpiHighlight label="TOTAL A PAGAR AO CONDOMÍNIO" value={money(total_pagar)} />
        </Section>

        {/* OBSERVAÇÕES (compacto pra não estourar página) */}
        {observacoes ? (
          <Section title="Observações">
            <Text style={styles.text}>{observacoes}</Text>
          </Section>
        ) : null}
      </Page>

      {/* ===================== PÁGINA 2 ===================== */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Anexos</Text>

        {anexosImagem.length === 0 ? (
          <Text style={styles.notice}>Nenhuma imagem disponível para anexos.</Text>
        ) : (
          <View style={styles.grid}>
            {anexosImagem.map((a, i) => (
              <View key={i} style={styles.imageBox}>
                <Text style={styles.imageLabel}>{a.tipo}</Text>
                <Image src={a.src as any} style={styles.image} />
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

/* ===================== COMPONENTES ===================== */

function Section({ title, children }: any) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
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

function Row({ values }: { values: string[] }) {
  return (
    <View style={styles.tr}>
      {values.map((v, i) => (
        <Text key={i} style={styles.td}>
          {v}
        </Text>
      ))}
    </View>
  );
}

function RowWithBorder({ values }: { values: string[] }) {
  return (
    <View style={[styles.tr, styles.trBorder]}>
      {values.map((v, i) => (
        <Text key={i} style={styles.td}>
          {v}
        </Text>
      ))}
    </View>
  );
}

/* ===================== KPI ===================== */

function KpiNormal({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiLine}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

function KpiBold({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiLine}>
      <Text style={styles.kpiLabelBold}>{label}</Text>
      <Text style={styles.kpiValueBold}>{value}</Text>
    </View>
  );
}

function KpiHighlight({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiHighlightBox}>
      <Text style={styles.kpiLabelHighlight}>{label}</Text>
      <Text style={styles.kpiValueHighlight}>{value}</Text>
    </View>
  );
}

/* ===================== HELPERS ===================== */

function money(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
  // enxuguei padding pra segurar 1 página
  page: { padding: 24, fontSize: 10 },

  title: { fontSize: 15, fontWeight: "bold", marginBottom: 6 },
  subtitle: { marginBottom: 10 },

  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", marginBottom: 5 },

  table: { borderWidth: 1, borderColor: "#000", marginBottom: 6 },
  tr: { flexDirection: "row" },
  trHeader: { backgroundColor: "#eee", borderBottomWidth: 1, borderColor: "#000" },
  trBorder: { borderTopWidth: 1, borderColor: "#000" },

  td: { flex: 1, padding: 3 },
  th: { fontWeight: "bold" },

  kpiLine: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  kpiLabel: { fontSize: 10 },
  kpiValue: { fontSize: 10 },
  kpiLabelBold: { fontSize: 10, fontWeight: "bold" },
  kpiValueBold: { fontSize: 10, fontWeight: "bold" },

  // destaque do total sem estourar layout
  kpiHighlightBox: {
    marginTop: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#000",
    backgroundColor: "#f2f2f2",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  kpiLabelHighlight: { fontSize: 11, fontWeight: "bold" },
  kpiValueHighlight: { fontSize: 11, fontWeight: "bold" },

  text: { fontSize: 10 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  imageBox: { width: "48%", margin: "1%" },
  imageLabel: { fontSize: 9, marginBottom: 2 },
  image: {
    width: "100%",
    height: 180,
    objectFit: "contain",
    borderWidth: 1,
    borderColor: "#000",
  },
  notice: { fontSize: 10, marginTop: 8 },
});
