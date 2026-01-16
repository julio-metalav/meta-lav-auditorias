import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  Link,
} from "@react-pdf/renderer";

type DTO = any;

Font.register({
  family: "Helvetica",
  fonts: [{ src: "https://fonts.gstatic.com/s/helvetica/v11/qkBIXvE4o4J0A.ttf" }],
});

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 16, marginBottom: 6, fontWeight: "bold" },
  subtitle: { fontSize: 11, marginBottom: 12, color: "#555" },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, marginBottom: 6, fontWeight: "bold" },

  table: { width: "100%", borderWidth: 1, borderColor: "#ddd" },
  row: { flexDirection: "row" },
  cell: { padding: 4, borderRightWidth: 1, borderColor: "#ddd" },
  cellLast: { padding: 4 },

  highlight: {
    marginTop: 6,
    padding: 6,
    backgroundColor: "#f4f4f5",
  },

  imagesGrid: {
    flexDirection: "row",
    gap: 12,
  },
  imageBox: {
    width: "30%",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 6,
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: 120,
    objectFit: "contain",
  },
  caption: { fontSize: 9, marginTop: 4 },
});

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RelatorioFinalPdf({ data }: { data: DTO }) {
  const anexos = [
    { label: "Medidor de Água", url: data.anexos?.foto_agua_url },
    { label: "Medidor de Energia", url: data.anexos?.foto_energia_url },
    { label: "Medidor de Gás", url: data.anexos?.foto_gas_url },
  ].filter((a) => a.url);

  return (
    <Document>
      {/* Página 1 */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>
          Relatório de Prestação de Contas – Lavanderia Compartilhada
        </Text>
        <Text style={styles.subtitle}>
          {data.meta.condominio_nome} — Competência {data.meta.competencia}
        </Text>

        {/* Vendas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Vendas por máquina</Text>
          <View style={styles.table}>
            {data.vendas_por_maquina.itens.map((i: any, idx: number) => (
              <View key={idx} style={styles.row}>
                <Text style={[styles.cell, { width: "30%" }]}>{i.maquina}</Text>
                <Text style={[styles.cell, { width: "15%" }]}>{i.tipo}</Text>
                <Text style={[styles.cell, { width: "15%" }]}>{i.ciclos}</Text>
                <Text style={[styles.cell, { width: "20%" }]}>{brl(i.valor_unitario)}</Text>
                <Text style={[styles.cellLast, { width: "20%" }]}>{brl(i.receita)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.highlight}>
            <Text>Receita Bruta: {brl(data.vendas_por_maquina.receita_bruta_total)}</Text>
            <Text>
              Cashback ({data.vendas_por_maquina.cashback_percent}%):{" "}
              {brl(data.vendas_por_maquina.valor_cashback)}
            </Text>
          </View>
        </View>

        {/* Consumo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Consumo de insumos</Text>
          {data.consumo_insumos.itens.map((c: any, idx: number) => (
            <Text key={idx}>
              {c.insumo}: {c.consumo} → {brl(c.valor_total)}
            </Text>
          ))}
          <View style={styles.highlight}>
            <Text>
              Total do repasse: {brl(data.consumo_insumos.total_repasse_consumo)}
            </Text>
          </View>
        </View>

        {/* Total */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Totalização final</Text>
          <Text>Cashback: {brl(data.totalizacao_final.cashback)}</Text>
          <Text>Repasse: {brl(data.totalizacao_final.repasse_consumo)}</Text>
          <Text style={{ fontWeight: "bold", marginTop: 4 }}>
            TOTAL A PAGAR AO CONDOMÍNIO:{" "}
            {brl(data.totalizacao_final.total_a_pagar_condominio)}
          </Text>
        </View>

        {/* Observações */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Observações</Text>
          <Text>{data.observacoes || "—"}</Text>
        </View>

        {/* Link comprovante */}
        {data.anexos?.comprovante_fechamento_url && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Comprovante</Text>
            <Link src={data.anexos.comprovante_fechamento_url}>
              Abrir comprovante de pagamento
            </Link>
          </View>
        )}
      </Page>

      {/* Página 2 – Anexos */}
      {anexos.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>
            ANEXOS – REGISTROS FOTOGRÁFICOS
          </Text>

          <View style={styles.imagesGrid}>
            {anexos.map((a, idx) => (
              <View key={idx} style={styles.imageBox}>
                <Image src={a.url} style={styles.image} />
                <Text style={styles.caption}>{a.label}</Text>
              </View>
            ))}
          </View>
        </Page>
      )}
    </Document>
  );
}
