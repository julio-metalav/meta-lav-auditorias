import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type DTO = any;

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 28,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },

  // header
  tiny: { fontSize: 9, color: "#6b7280" },
  h1: { fontSize: 18, fontWeight: 700, marginTop: 2 },
  subtitle: { fontSize: 10, color: "#6b7280", marginTop: 2 },

  // card
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  badge: {
    fontSize: 9,
    color: "#6b7280",
    letterSpacing: 0.5,
  },
  condoName: { fontSize: 16, fontWeight: 700, marginTop: 4 },
  comp: { marginTop: 2, fontSize: 10, color: "#6b7280" },

  // section
  section: { marginTop: 14 },
  secTitleRow: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  secN: { fontSize: 10, fontWeight: 700, color: "#6b7280" },
  secTitle: { fontSize: 13, fontWeight: 700 },
  secHint: { marginTop: 4, fontSize: 9, color: "#6b7280" },

  // table
  table: { marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, overflow: "hidden" },
  tr: { flexDirection: "row" },
  thead: { backgroundColor: "#f3f4f6" },
  th: { fontSize: 9, fontWeight: 700, color: "#374151", paddingVertical: 8, paddingHorizontal: 10 },
  td: { fontSize: 10, paddingVertical: 8, paddingHorizontal: 10, color: "#111827" },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#e5e7eb" },

  right: { textAlign: "right" },

  // kpis
  kpiRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  kpi: { flex: 1, backgroundColor: "#f3f4f6", borderRadius: 10, padding: 10 },
  kpiLabel: { fontSize: 9, color: "#6b7280" },
  kpiValue: { marginTop: 3, fontSize: 12, fontWeight: 700 },

  // total table
  totalBox: { marginTop: 10, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, overflow: "hidden" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12 },
  totalRowBorder: { borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  totalStrongRow: { backgroundColor: "#f3f4f6" },
  totalStrong: { fontSize: 12, fontWeight: 700 },

  // obs
  obsBox: { marginTop: 8, backgroundColor: "#f3f4f6", borderRadius: 10, padding: 10 },

  // anexos (page 2)
  anexosTitle: { fontSize: 13, fontWeight: 700, marginTop: 4 },
  anexosSub: { fontSize: 9, color: "#6b7280", marginTop: 2 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  imgCard: { width: "48%", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 10 },
  imgLabel: { fontSize: 10, fontWeight: 700, marginBottom: 6 },
  img: { width: "100%", height: 180, objectFit: "contain" },

  // when image not embeddable
  warn: { fontSize: 9, color: "#6b7280", marginTop: 6 },
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
function isImageUrl(url?: string | null) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".webp");
}

export function RelatorioFinalPdf({ data }: { data: DTO }) {
  const vendas = data?.vendas_por_maquina?.itens ?? [];
  const consumo = data?.consumo_insumos?.itens ?? [];

  // anexos (sem links — só embute se for imagem)
  const anexos = [
    { key: "agua", label: "Foto do medidor — Água", url: data?.anexos?.foto_agua_url },
    { key: "energia", label: "Foto do medidor — Energia", url: data?.anexos?.foto_energia_url },
    { key: "gas", label: "Foto do medidor — Gás", url: data?.anexos?.foto_gas_url },
    { key: "comp", label: "Comprovante de pagamento", url: data?.anexos?.comprovante_fechamento_url },
  ].filter((a: any) => !!a.url);

  const anexosImagem = anexos.filter((a: any) => isImageUrl(a.url));
  const anexosNaoImagem = anexos.filter((a: any) => !isImageUrl(a.url));

  return (
    <Document>
      {/* PAGE 1 */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.tiny}>Relatório final</Text>
        <Text style={styles.h1}>Prestação de Contas — Lavanderia Compartilhada</Text>
        <Text style={styles.subtitle}>Relatório de prestação de contas — Lavanderia Compartilhada</Text>

        {/* CAPA CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={styles.badge}>META LAV</Text>
              <Text style={styles.condoName}>{data?.meta?.condominio_nome ?? "—"}</Text>
              <Text style={styles.comp}>Competência: {data?.meta?.competencia ?? "—"}</Text>
            </View>

            <View>
              <Text style={[styles.tiny, { textAlign: "right" }]}>Gerado em</Text>
              <Text style={[styles.tiny, { textAlign: "right" }]}>
                {data?.meta?.gerado_em ? new Date(data.meta.gerado_em).toLocaleString("pt-BR") : "—"}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 10, backgroundColor: "#f3f4f6", borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: 700 }}>Relatório de Prestação de Contas – Lavanderia Compartilhada</Text>
            <Text style={{ marginTop: 3, fontSize: 9, color: "#6b7280" }}>
              Auditoria finalizada. Valores abaixo consolidam vendas, cashback e repasse de consumo.
            </Text>
          </View>
        </View>

        {/* 1 VENDAS */}
        <View style={styles.section}>
          <View style={styles.secTitleRow}>
            <Text style={styles.secN}>1</Text>
            <Text style={styles.secTitle}>Vendas por máquina</Text>
          </View>
          <Text style={styles.secHint}>Máquina — Qtde ciclos — Valor unitário — Valor total</Text>

          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: "40%" }]}>Máquina</Text>
              <Text style={[styles.th, styles.right, { width: "15%" }]}>Ciclos</Text>
              <Text style={[styles.th, styles.right, { width: "20%" }]}>Valor unitário</Text>
              <Text style={[styles.th, styles.right, { width: "25%" }]}>Valor total</Text>
            </View>

            {vendas.map((i: any, idx: number) => (
              <View key={idx} style={[styles.tr, idx === 0 ? null : styles.rowBorder]}>
                <Text style={[styles.td, { width: "40%" }]}>{i.maquina}</Text>
                <Text style={[styles.td, styles.right, { width: "15%" }]}>{fmt(i.ciclos)}</Text>
                <Text style={[styles.td, styles.right, { width: "20%" }]}>{brl(i.valor_unitario)}</Text>
                <Text style={[styles.td, styles.right, { width: "25%", fontWeight: 700 }]}>{brl(i.valor_total)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.kpiRow}>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Receita Bruta Total</Text>
              <Text style={styles.kpiValue}>{brl(data?.vendas_por_maquina?.receita_bruta_total)}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Cashback</Text>
              <Text style={styles.kpiValue}>{fmt(data?.vendas_por_maquina?.cashback_percent)}%</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Valor do Cashback</Text>
              <Text style={styles.kpiValue}>{brl(data?.vendas_por_maquina?.valor_cashback)}</Text>
            </View>
          </View>
        </View>

        {/* 2 INSUMOS */}
        <View style={styles.section}>
          <View style={styles.secTitleRow}>
            <Text style={styles.secN}>2</Text>
            <Text style={styles.secTitle}>Consumo de insumos</Text>
          </View>
          <Text style={styles.secHint}>
            Insumo — Medição anterior — Medição atual — Consumo — Valor unitário — Valor total
          </Text>

          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: "18%" }]}>Insumo</Text>
              <Text style={[styles.th, styles.right, { width: "16%" }]}>Leitura anterior</Text>
              <Text style={[styles.th, styles.right, { width: "16%" }]}>Leitura atual</Text>
              <Text style={[styles.th, styles.right, { width: "14%" }]}>Consumo</Text>
              <Text style={[styles.th, styles.right, { width: "18%" }]}>Valor unitário</Text>
              <Text style={[styles.th, styles.right, { width: "18%" }]}>Valor total</Text>
            </View>

            {consumo.map((c: any, idx: number) => (
              <View key={idx} style={[styles.tr, idx === 0 ? null : styles.rowBorder]}>
                <Text style={[styles.td, { width: "18%" }]}>{c.insumo}</Text>
                <Text style={[styles.td, styles.right, { width: "16%" }]}>{fmt(c.leitura_anterior)}</Text>
                <Text style={[styles.td, styles.right, { width: "16%" }]}>{fmt(c.leitura_atual)}</Text>
                <Text style={[styles.td, styles.right, { width: "14%" }]}>{fmt(c.consumo)}</Text>
                <Text style={[styles.td, styles.right, { width: "18%" }]}>{brl(c.valor_unitario)}</Text>
                <Text style={[styles.td, styles.right, { width: "18%", fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.kpi, { marginTop: 10 }]}>
            <Text style={styles.kpiLabel}>Total do Repasse de Consumo</Text>
            <Text style={styles.kpiValue}>{brl(data?.consumo_insumos?.total_repasse_consumo)}</Text>
          </View>
        </View>

        {/* 3 TOTAL */}
        <View style={styles.section}>
          <View style={styles.secTitleRow}>
            <Text style={styles.secN}>3</Text>
            <Text style={styles.secTitle}>Totalização final</Text>
          </View>
          <Text style={styles.secHint}>Este é o número principal do relatório</Text>

          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <Text>Cashback</Text>
              <Text style={{ fontWeight: 700 }}>{brl(data?.totalizacao_final?.cashback)}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowBorder]}>
              <Text>Repasse de consumo</Text>
              <Text style={{ fontWeight: 700 }}>{brl(data?.totalizacao_final?.repasse_consumo)}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowBorder, styles.totalStrongRow]}>
              <Text style={styles.totalStrong}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
              <Text style={styles.totalStrong}>{brl(data?.totalizacao_final?.total_a_pagar_condominio)}</Text>
            </View>
          </View>
        </View>

        {/* 4 OBS */}
        <View style={styles.section}>
          <View style={styles.secTitleRow}>
            <Text style={styles.secN}>4</Text>
            <Text style={styles.secTitle}>Observações</Text>
          </View>

          <View style={styles.obsBox}>
            <Text>{data?.observacoes?.trim?.() ? data.observacoes : "—"}</Text>
          </View>
        </View>

        {/* Nota se existir comprovante não embutível */}
        {anexosNaoImagem.length > 0 && (
          <Text style={styles.warn}>
            Observação: alguns anexos estão em formato não suportado para embutir como imagem (ex.: PDF). Nesses casos,
            o anexo permanece registrado no sistema.
          </Text>
        )}
      </Page>

      {/* PAGE 2 — ANEXOS (SEM LINKS, EMBUTIDOS) */}
      {(anexosImagem.length > 0) && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.tiny}>Anexos</Text>
          <Text style={styles.anexosTitle}>Fotos e comprovante (embutidos)</Text>
          <Text style={styles.anexosSub}>Imagens registradas durante a auditoria e/ou fechamento</Text>

          <View style={styles.grid}>
            {anexosImagem.map((a: any, idx: number) => (
              <View key={idx} style={styles.imgCard}>
                <Text style={styles.imgLabel}>{a.label}</Text>
                <Image src={a.url} style={styles.img} />
              </View>
            ))}
          </View>
        </Page>
      )}
    </Document>
  );
}
