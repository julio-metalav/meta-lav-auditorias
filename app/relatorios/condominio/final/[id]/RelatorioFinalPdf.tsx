import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, Link } from "@react-pdf/renderer";

type DTO = any;

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10, fontFamily: "Helvetica" },

  h1: { fontSize: 16, fontWeight: "bold" },
  sub: { marginTop: 4, fontSize: 11, color: "#444" },

  section: { marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", marginBottom: 4 },
  hint: { fontSize: 9, color: "#666", marginBottom: 6 },

  table: { borderWidth: 1, borderColor: "#ddd" },
  tr: { flexDirection: "row" },
  th: { backgroundColor: "#f4f4f5", fontWeight: "bold" },
  td: { padding: 5, borderRightWidth: 1, borderRightColor: "#ddd" },
  tdLast: { padding: 5 },

  rowBorder: { borderTopWidth: 1, borderTopColor: "#eee" },

  kpiBox: { marginTop: 8, padding: 8, backgroundColor: "#f4f4f5" },
  kpiLine: { fontSize: 10, marginTop: 2 },

  totalStrong: { fontSize: 12, fontWeight: "bold", marginTop: 6 },

  anexosTitle: { marginTop: 10, fontSize: 11, fontWeight: "bold" },
  grid: { flexDirection: "row", gap: 10, marginTop: 6 },
  imgBox: { width: "32%", borderWidth: 1, borderColor: "#ddd", padding: 6, alignItems: "center" },
  img: { width: "100%", height: 78, objectFit: "contain" },
  cap: { fontSize: 9, marginTop: 4, color: "#333" },
});

function brl(v: any) {
  const n = Number(v);
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(v: any) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}

export function RelatorioFinalPdf({ data }: { data: DTO }) {
  const anexos = [
    { label: "Água", url: data?.anexos?.foto_agua_url },
    { label: "Energia", url: data?.anexos?.foto_energia_url },
    { label: "Gás", url: data?.anexos?.foto_gas_url },
  ].filter((a: any) => !!a.url);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Relatório de Prestação de Contas – Lavanderia Compartilhada</Text>
        <Text style={styles.sub}>
          {data?.meta?.condominio_nome} — Competência {data?.meta?.competencia}
        </Text>

        {/* 1 VENDAS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Vendas por máquina</Text>
          <Text style={styles.hint}>Máquina — Qtde ciclos — Valor unitário — Valor total</Text>

          <View style={styles.table}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.td, { width: "40%" }]}>Máquina</Text>
              <Text style={[styles.td, { width: "15%", textAlign: "right" }]}>Ciclos</Text>
              <Text style={[styles.td, { width: "20%", textAlign: "right" }]}>Valor unitário</Text>
              <Text style={[styles.tdLast, { width: "25%", textAlign: "right" }]}>Valor total</Text>
            </View>

            {(data?.vendas_por_maquina?.itens ?? []).map((i: any, idx: number) => (
              <View key={idx} style={[styles.tr, styles.rowBorder]}>
                <Text style={[styles.td, { width: "40%" }]}>{i.maquina}</Text>
                <Text style={[styles.td, { width: "15%", textAlign: "right" }]}>{fmt(i.ciclos)}</Text>
                <Text style={[styles.td, { width: "20%", textAlign: "right" }]}>{brl(i.valor_unitario)}</Text>
                <Text style={[styles.tdLast, { width: "25%", textAlign: "right" }]}>{brl(i.valor_total)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.kpiBox}>
            <Text style={styles.kpiLine}>Receita Bruta: {brl(data?.vendas_por_maquina?.receita_bruta_total)}</Text>
            <Text style={styles.kpiLine}>
              Cashback ({fmt(data?.vendas_por_maquina?.cashback_percent)}%): {brl(data?.vendas_por_maquina?.valor_cashback)}
            </Text>
          </View>
        </View>

        {/* 2 INSUMOS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Consumo de insumos</Text>
          <Text style={styles.hint}>
            Insumo — Medição anterior — Medição atual — Consumo — Valor unitário — Valor total
          </Text>

          <View style={styles.table}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.td, { width: "18%" }]}>Insumo</Text>
              <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>Leitura anterior</Text>
              <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>Leitura atual</Text>
              <Text style={[styles.td, { width: "14%", textAlign: "right" }]}>Consumo</Text>
              <Text style={[styles.td, { width: "18%", textAlign: "right" }]}>Valor unitário</Text>
              <Text style={[styles.tdLast, { width: "18%", textAlign: "right" }]}>Valor total</Text>
            </View>

            {(data?.consumo_insumos?.itens ?? []).map((c: any, idx: number) => (
              <View key={idx} style={[styles.tr, styles.rowBorder]}>
                <Text style={[styles.td, { width: "18%" }]}>{c.insumo}</Text>
                <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>{fmt(c.leitura_anterior)}</Text>
                <Text style={[styles.td, { width: "16%", textAlign: "right" }]}>{fmt(c.leitura_atual)}</Text>
                <Text style={[styles.td, { width: "14%", textAlign: "right" }]}>{fmt(c.consumo)}</Text>
                <Text style={[styles.td, { width: "18%", textAlign: "right" }]}>{brl(c.valor_unitario)}</Text>
                <Text style={[styles.tdLast, { width: "18%", textAlign: "right" }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.kpiBox}>
            <Text style={styles.kpiLine}>Total do repasse: {brl(data?.consumo_insumos?.total_repasse_consumo)}</Text>
          </View>
        </View>

        {/* 3 TOTAL */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Totalização final</Text>
          <Text style={styles.kpiLine}>Cashback: {brl(data?.totalizacao_final?.cashback)}</Text>
          <Text style={styles.kpiLine}>Repasse: {brl(data?.totalizacao_final?.repasse_consumo)}</Text>
          <Text style={styles.totalStrong}>
            TOTAL A PAGAR AO CONDOMÍNIO: {brl(data?.totalizacao_final?.total_a_pagar_condominio)}
          </Text>
        </View>

        {/* 4 OBS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Observações</Text>
          <Text>{data?.observacoes?.trim?.() ? data.observacoes : "—"}</Text>
        </View>

        {/* Comprovante (link) */}
        {!!data?.anexos?.comprovante_fechamento_url && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Comprovante</Text>
            <Link src={data.anexos.comprovante_fechamento_url}>Abrir comprovante de pagamento</Link>
          </View>
        )}

        {/* ANEXOS (fotos pequenas na mesma página) */}
        {anexos.length > 0 && (
          <View>
            <Text style={styles.anexosTitle}>5. Anexos – Fotos dos medidores</Text>
            <View style={styles.grid}>
              {anexos.slice(0, 3).map((a: any, idx: number) => (
                <View key={idx} style={styles.imgBox}>
                  <Image src={a.url} style={styles.img} />
                  <Text style={styles.cap}>{a.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
