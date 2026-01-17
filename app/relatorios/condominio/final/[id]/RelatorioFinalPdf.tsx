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
        <Text style={styles.title}>Relatório Mensal – Meta Lav</Text>
        <Text style={styles.subtitle}>
          Condomínio: {condominio.nome}{"\n"}
          Período: {periodo}
        </Text>

        {/* VENDAS */}
        <Section title="Vendas por Máquina">
          <Text style={styles.helper}>
            Máquina — Qtde de ciclos — Valor unitário — Valor total
          </Text>

          <Table>
            <HeaderRow
              cols={["Máquina", "Ciclos", "Valor unitário", "Valor total"]}
            />
            {vendas.map((v, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  values={[
                    v.maquina,
                    v.ciclos.toString(),
                    money(v.valor_unitario),
                    money(v.valor_total),
                  ]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  values={[
                    v.maquina,
                    v.ciclos.toString(),
                    money(v.valor_unitario),
                    money(v.valor_total),
                  ]}
                />
              )
            )}
          </Table>

          <KpiNormal
            label="Receita Bruta Total"
            value={money(kpis.receita_bruta)}
          />
          <KpiNormal
            label={`Cashback (${kpis.cashback_percentual}%)`}
            value={money(kpis.cashback_valor)}
          />
        </Section>

        {/* CONSUMO */}
        <Section title="Consumo de Insumos">
          <Text style={styles.helper}>
            Insumo — Medição anterior — Medição atual — Consumo — Valor unitário —
            Valor total
          </Text>

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
            />
            {consumos.map((c, i) =>
              i === 0 ? (
                <Row
                  key={i}
                  values={[
                    c.nome,
                    c.anterior.toString(),
                    c.atual.toString(),
                    c.consumo.toString(),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              ) : (
                <RowWithBorder
                  key={i}
                  values={[
                    c.nome,
                    c.anterior.toString(),
                    c.atual.toString(),
                    c.consumo.toString(),
                    money(c.valor_unitario),
                    money(c.valor_total),
                  ]}
                />
              )
            )}
          </Table>

          <KpiBold
            label="Total do repasse de consumo"
            value={money(total_consumo)}
          />
        </Section>

        {/* TOTALIZAÇÃO */}
        <Section title="Totalização Final">
          <KpiNormal label="Cashback" value={money(total_cashback)} />
          <KpiNormal label="Repasse de consumo" value={money(total_consumo)} />
          <KpiHighlight
            label="TOTAL A PAGAR AO CONDOMÍNIO"
            value={money(total_pagar)}
          />
        </Section>

        {/* OBSERVAÇÕES */}
        {observacoes && (
          <Section title="Observações">
            <Text style={styles.text}>{observacoes}</Text>
          </Section>
        )}
      </Page>

      {/* ===================== PÁGINA 2 ===================== */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Anexos</Text>

        <View style={styles.grid}>
          {anexos.map((a, i) =>
            a.isImagem && a.url ? (
              <View key={i} style={styles.imageBox}>
                <Text style={styles.imageLabel}>{a.tipo}</Text>
                <Image src={a.url} style={styles.image} />
              </View>
            ) : (
              <Text key={i} style={styles.notice}>
                {a.tipo}: anexo não é imagem
              </Text>
            )
          )}
        </View>
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

/* ===================== KPI (SEM CONDICIONAIS) ===================== */

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
    <View style={styles.kpiLine}>
      <Text style={styles.kpiLabelHighlight}>{label}</Text>
      <Text style={styles.kpiValueHighlight}>{value}</Text>
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
  page: { padding: 32, fontSize: 10 },
  title: { fontSize: 16, fontWeight: "bold", marginBottom: 8 },
  subtitle: { marginBottom: 16 },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", marginBottom: 6 },
  helper: { fontSize: 9, marginBottom: 4, color: "#555" },

  table: { borderWidth: 1, borderColor: "#000", marginBottom: 8 },
  tr: { flexDirection: "row" },
  trHeader: {
    backgroundColor: "#eee",
    borderBottomWidth: 1,
    borderColor: "#000",
  },
  trBorder: { borderTopWidth: 1, borderColor: "#000" },
  td: { flex: 1, padding: 4 },
  th: { fontWeight: "bold" },

  kpiLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  kpiLabel: { fontSize: 10 },
  kpiValue: { fontSize: 10 },
  kpiLabelBold: { fontSize: 10, fontWeight: "bold" },
  kpiValueBold: { fontSize: 10, fontWeight: "bold" },
  kpiLabelHighlight: { fontSize: 12, fontWeight: "bold" },
  kpiValueHighlight: { fontSize: 12, fontWeight: "bold" },

  text: { fontSize: 10 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  imageBox: { width: "48%", margin: "1%" },
  imageLabel: { fontSize: 9, marginBottom: 2 },
  image: {
    width: "100%",
    height: 200,
    objectFit: "contain",
    borderWidth: 1,
    borderColor: "#000",
  },
  notice: { fontSize: 9, marginBottom: 6 },
});
