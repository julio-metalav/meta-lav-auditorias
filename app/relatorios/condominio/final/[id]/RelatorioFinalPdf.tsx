import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

type Props = {
  condominio: { nome: string };
  periodo: string;

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
    valor_unitario: number;
    valor_total: number;
  }>;

  total_consumo: number;
  total_cashback: number;
  total_pagar: number;

  observacoes?: string;

  // opcional (não quebra nada se não vier)
  pagamento?: {
    pix?: string;
    banco_codigo?: string;
    banco_nome?: string;
    agencia?: string;
    conta?: string;
    cnpj?: string;
  };

  anexos: AnexoPdf[];
};

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function brl(v: any) {
  const x = n(v);
  // evita depender de ambientes sem locale completo
  return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtInt(v: any) {
  const x = n(v);
  return x.toLocaleString("pt-BR");
}

function fmtLeitura(v: any) {
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("pt-BR");
}

function imgSrcToDataUri(src: ImageSrcObj) {
  const base64 = src.data.toString("base64");
  const mime = src.format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${base64}`;
}

const styles = StyleSheet.create({
  page: {
    size: "A4",
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 28,
    fontSize: 10,
    color: "#111827",
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  brand: { fontSize: 11, fontWeight: 700, color: "#111827" },
  title: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  subtitle: { fontSize: 10, color: "#6B7280", marginTop: 2 },

  metaBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    minWidth: 180,
  },
  metaLabel: { fontSize: 8, color: "#6B7280" },
  metaValue: { fontSize: 10, fontWeight: 700, marginTop: 1 },

  section: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionN: { fontSize: 9, fontWeight: 700, color: "#6B7280" },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "#111827" },
  sectionSub: { fontSize: 9, color: "#6B7280", marginTop: 3 },

  table: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    overflow: "hidden",
  },
  trHead: { flexDirection: "row", backgroundColor: "#F9FAFB" },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  th: { paddingVertical: 8, paddingHorizontal: 8, fontSize: 9, color: "#374151", fontWeight: 700 },
  td: { paddingVertical: 8, paddingHorizontal: 8, fontSize: 9, color: "#111827" },

  colMaquina: { width: "44%" },
  colNum: { width: "14%" },
  colMoney: { width: "21%" },

  colInsumo: { width: "28%" },
  colRead: { width: "18%" },
  colCons: { width: "18%" },
  colVal: { width: "18%" },

  right: { textAlign: "right" },

  kpiRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  kpi: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#F9FAFB",
  },
  kpiLabel: { fontSize: 8, color: "#6B7280" },
  kpiValue: { fontSize: 12, fontWeight: 700, marginTop: 2 },

  totalTable: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    overflow: "hidden",
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 10, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  totalRowHead: { flexDirection: "row", justifyContent: "space-between", padding: 10 },
  totalStrong: { fontSize: 11, fontWeight: 700 },
  totalBig: { fontSize: 14, fontWeight: 700 },

  obsBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#F9FAFB",
    minHeight: 46,
  },
  obsText: { fontSize: 9, color: "#111827" },

  bankBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#FFFFFF",
  },
  bankLine: { fontSize: 9, color: "#111827", marginTop: 3 },

  footer: {
    position: "absolute",
    bottom: 18,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    color: "#6B7280",
    fontSize: 8,
  },

  anexoTitle: { fontSize: 13, fontWeight: 700 },
  anexoSub: { fontSize: 9, color: "#6B7280", marginTop: 2 },
  anexoBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    height: 680, // área “segura” pra imagem em A4
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  anexoImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  anexoFallback: { fontSize: 10, color: "#6B7280", textAlign: "center" },
});

function Footer({ periodo }: { periodo: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>META LAV — Prestação de Contas</Text>
      <Text>Competência: {periodo}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} / ${totalPages}`
        }
      />
    </View>
  );
}

export default function RelatorioFinalPdf(props: Props) {
  const {
    condominio,
    periodo,
    vendas,
    kpis,
    consumos,
    total_consumo,
    total_cashback,
    total_pagar,
    observacoes,
    pagamento,
    anexos,
  } = props;

  const hasPix = Boolean((pagamento?.pix || "").trim());
  const hasConta = Boolean((pagamento?.agencia || "").trim() || (pagamento?.conta || "").trim());

  const bancoLabel = (() => {
    const codigo = (pagamento?.banco_codigo || "").trim();
    const nome = (pagamento?.banco_nome || "").trim();
    if (nome && codigo) return `${nome} (${codigo})`;
    if (codigo) return `Banco (${codigo})`;
    if (nome) return nome;
    return "Banco";
  })();

  return (
    <Document>
      {/* PAGE 1: RESUMO */}
      <Page style={styles.page} size="A4">
        <View style={styles.headerRow}>
          <View style={{ maxWidth: 340 }}>
            <Text style={styles.brand}>META LAV</Text>
            <Text style={styles.title}>Prestação de Contas</Text>
            <Text style={styles.subtitle}>Lavanderia Compartilhada — Relatório final</Text>
          </View>

          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Condomínio</Text>
            <Text style={styles.metaValue}>{condominio?.nome || "—"}</Text>

            <View style={{ marginTop: 8 }}>
              <Text style={styles.metaLabel}>Competência</Text>
              <Text style={styles.metaValue}>{periodo || "—"}</Text>
            </View>
          </View>
        </View>

        {/* 1 VENDAS */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionN}>1</Text>
            <Text style={styles.sectionTitle}>Vendas por máquina</Text>
          </View>
          <Text style={styles.sectionSub}>Fechamento de caixa por máquina/capacidade</Text>

          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, styles.colMaquina]}>Máquina</Text>
              <Text style={[styles.th, styles.colNum, styles.right]}>Ciclos</Text>
              <Text style={[styles.th, styles.colMoney, styles.right]}>Valor unit.</Text>
              <Text style={[styles.th, styles.colMoney, styles.right]}>Receita</Text>
            </View>

            {vendas?.length ? (
              vendas.map((v, i) => (
                <View key={i} style={styles.tr} wrap={false}>
                  <Text style={[styles.td, styles.colMaquina]}>{v.maquina || "—"}</Text>
                  <Text style={[styles.td, styles.colNum, styles.right]}>{fmtInt(v.ciclos)}</Text>
                  <Text style={[styles.td, styles.colMoney, styles.right]}>{brl(v.valor_unitario)}</Text>
                  <Text style={[styles.td, styles.colMoney, styles.right, { fontWeight: 700 }]}>
                    {brl(v.valor_total)}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.tr}>
                <Text style={[styles.td, { padding: 10, color: "#6B7280" }]}>Sem dados de vendas.</Text>
              </View>
            )}
          </View>

          <View style={styles.kpiRow}>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Receita Bruta Total</Text>
              <Text style={styles.kpiValue}>{brl(kpis?.receita_bruta)}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Cashback (%)</Text>
              <Text style={styles.kpiValue}>{fmtInt(kpis?.cashback_percentual)}%</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Valor do Cashback</Text>
              <Text style={styles.kpiValue}>{brl(kpis?.cashback_valor)}</Text>
            </View>
          </View>
        </View>

        {/* 2 CONSUMO */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionN}>2</Text>
            <Text style={styles.sectionTitle}>Consumo de insumos</Text>
          </View>
          <Text style={styles.sectionSub}>Leitura anterior, leitura atual, consumo e repasse</Text>

          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, styles.colInsumo]}>Insumo</Text>
              <Text style={[styles.th, styles.colRead, styles.right]}>Anterior</Text>
              <Text style={[styles.th, styles.colRead, styles.right]}>Atual</Text>
              <Text style={[styles.th, styles.colCons, styles.right]}>Consumo</Text>
              <Text style={[styles.th, styles.colVal, styles.right]}>Repasse</Text>
            </View>

            {consumos?.length ? (
              consumos.map((c, i) => (
                <View key={i} style={styles.tr} wrap={false}>
                  <Text style={[styles.td, styles.colInsumo]}>{c.nome || "—"}</Text>
                  <Text style={[styles.td, styles.colRead, styles.right]}>{fmtLeitura(c.anterior)}</Text>
                  <Text style={[styles.td, styles.colRead, styles.right]}>{fmtLeitura(c.atual)}</Text>
                  <Text style={[styles.td, styles.colCons, styles.right]}>{fmtInt(c.consumo)}</Text>
                  <Text style={[styles.td, styles.colVal, styles.right, { fontWeight: 700 }]}>
                    {brl(c.valor_total)}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.tr}>
                <Text style={[styles.td, { padding: 10, color: "#6B7280" }]}>Sem dados de consumo.</Text>
              </View>
            )}
          </View>

          <View style={styles.kpiRow}>
            <View style={[styles.kpi, { flexBasis: "100%" }]}>
              <Text style={styles.kpiLabel}>Total do Repasse de Consumo</Text>
              <Text style={styles.kpiValue}>{brl(total_consumo)}</Text>
            </View>
          </View>
        </View>

        {/* 3 TOTALIZAÇÃO */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionN}>3</Text>
            <Text style={styles.sectionTitle}>Totalização final</Text>
          </View>
          <Text style={styles.sectionSub}>Número principal do relatório</Text>

          <View style={styles.totalTable}>
            <View style={styles.totalRowHead}>
              <Text>Cashback</Text>
              <Text style={{ fontWeight: 700 }}>{brl(total_cashback)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Repasse de consumo</Text>
              <Text style={{ fontWeight: 700 }}>{brl(total_consumo)}</Text>
            </View>
            <View style={[styles.totalRow, { backgroundColor: "#F9FAFB" }]}>
              <Text style={styles.totalStrong}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
              <Text style={styles.totalBig}>{brl(total_pagar)}</Text>
            </View>
          </View>

          {/* DADOS BANCÁRIOS (opcional) */}
          {(hasPix || hasConta) && (
            <View style={styles.bankBox}>
              <Text style={{ fontSize: 9, fontWeight: 700 }}>Dados para pagamento</Text>

              {hasPix ? (
                <Text style={styles.bankLine}>PIX: {pagamento?.pix}</Text>
              ) : null}

              {hasConta ? (
                <>
                  <Text style={styles.bankLine}>
                    {bancoLabel} | Agência: {pagamento?.agencia || "—"} | Conta: {pagamento?.conta || "—"}
                  </Text>
                  <Text style={styles.bankLine}>CNPJ: {pagamento?.cnpj || "—"}</Text>
                </>
              ) : null}
            </View>
          )}
        </View>

        {/* 4 OBS */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionN}>4</Text>
            <Text style={styles.sectionTitle}>Observações</Text>
          </View>

          <View style={styles.obsBox}>
            <Text style={styles.obsText}>
              {observacoes?.trim() ? observacoes.trim() : "—"}
            </Text>
          </View>
        </View>

        <Footer periodo={periodo || "—"} />
      </Page>

      {/* ANEXOS: 1 por página (evita PDF “quebrado” e páginas vazias) */}
      {(anexos || [])
        .filter((a) => a && a.tipo)
        .map((a, idx) => {
          const hasImg = Boolean(a?.isImagem && a?.src?.data);
          const uri = hasImg ? imgSrcToDataUri(a.src as ImageSrcObj) : null;

          return (
            <Page key={`anexo-${idx}`} style={styles.page} size="A4">
              <View>
                <Text style={styles.brand}>META LAV</Text>
                <Text style={styles.anexoTitle}>Anexo</Text>
                <Text style={styles.anexoSub}>{a.tipo}</Text>

                <View style={styles.anexoBox}>
                  {uri ? (
                    <Image src={uri} style={styles.anexoImg} />
                  ) : (
                    <Text style={styles.anexoFallback}>
                      Não foi possível incorporar este anexo no PDF.
                      {"\n"}(o arquivo pode estar indisponível, grande demais ou não ser imagem)
                    </Text>
                  )}
                </View>
              </View>

              <Footer periodo={periodo || "—"} />
            </Page>
          );
        })}
    </Document>
  );
}
