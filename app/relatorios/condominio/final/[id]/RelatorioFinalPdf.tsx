import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type ImageSrcObj = { data: Buffer; format: "png" | "jpg" };
type AnexoPdf = { tipo: string; src?: ImageSrcObj; isImagem: boolean };

type Props = {
  logo?: ImageSrcObj | null;

  condominio: { nome: string };
  periodo: string;
  gerado_em?: string;

  vendas: Array<{ maquina: string; ciclos: number; valor_unitario: number; valor_total: number }>;
  kpis: { receita_bruta: number; cashback_percentual: number; cashback_valor: number };
  consumos: Array<{ nome: string; anterior: number; atual: number; consumo: number; valor_unitario: number; valor_total: number }>;

  total_consumo: number;
  total_cashback: number;
  total_pagar: number;

  observacoes?: string;
  anexos: AnexoPdf[];
};

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function brl(v: any) {
  return num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtInt(v: any) {
  return num(v).toLocaleString("pt-BR");
}
function fmtLeitura(v: any) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}
function imgSrcToDataUri(src: ImageSrcObj) {
  const base64 = src.data.toString("base64");
  const mime = src.format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${base64}`;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// “Nível Itaú”: hierarquia forte + bordas limpas + total em bloco escuro.
// (sem refatoração de regras, só layout)
const C = {
  ink: "#0B1F35",
  steel: "#334155",
  muted: "#64748B",
  line: "#E2E8F0",
  bg: "#F8FAFC",
};

const S = StyleSheet.create({
  page: { size: "A4", paddingTop: 26, paddingBottom: 26, paddingHorizontal: 26, fontFamily: "Helvetica", fontSize: 10, color: C.ink, lineHeight: 1.25 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 12, marginBottom: 12 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1 },
  logo: { width: 48, height: 48, objectFit: "contain" },
  h1: { fontSize: 16, fontWeight: 700, color: C.ink },
  h2: { fontSize: 9, color: C.muted, marginTop: 2 },

  meta: { width: 230, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, backgroundColor: "#FFFFFF" },
  metaLabel: { fontSize: 8, color: C.muted },
  metaValue: { fontSize: 10, fontWeight: 700, marginTop: 2, color: C.ink },

  grid: { flexDirection: "row", gap: 10 },
  col: { flexGrow: 1, flexBasis: 0 },

  card: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 10, marginBottom: 10, backgroundColor: "#FFFFFF" },
  cardTitle: { fontSize: 11, fontWeight: 700, color: C.ink },
  cardSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  table: { marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden" },
  trH: { flexDirection: "row", backgroundColor: C.bg },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line },
  th: { paddingVertical: 6, paddingHorizontal: 7, fontSize: 9, fontWeight: 700, color: C.steel },
  td: { paddingVertical: 6, paddingHorizontal: 7, fontSize: 9, color: C.ink },
  right: { textAlign: "right" },

  // vendas
  cMaquina: { width: "46%" },
  cCiclos: { width: "14%" },
  cVU: { width: "20%" },
  cRec: { width: "20%" },

  // consumo
  cInsumo: { width: "24%" },
  cAnt: { width: "16%" },
  cAtu: { width: "16%" },
  cCons: { width: "16%" },
  cRep: { width: "28%" },

  kpiRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  kpi: { flexGrow: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 9, backgroundColor: C.bg },
  kpiLabel: { fontSize: 8, color: C.muted },
  kpiValue: { fontSize: 12, fontWeight: 700, marginTop: 2, color: C.ink },

  miniLine: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  miniLabel: { fontSize: 9, color: C.muted },
  miniVal: { fontSize: 9, fontWeight: 700, color: C.ink },

  totalBox: { marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: C.ink },
  totalLabel: { fontSize: 9, color: "#CBD5E1" },
  totalValue: { fontSize: 18, fontWeight: 700, color: "#FFFFFF", marginTop: 2 },

  obsBox: { marginTop: 10, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, backgroundColor: C.bg },
  obsText: { fontSize: 9, color: C.ink },

  footer: { position: "absolute", bottom: 14, left: 26, right: 26, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted },

  // anexos (2 por página)
  anHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 10, marginBottom: 10 },
  anTitle: { fontSize: 14, fontWeight: 700, color: C.ink },
  anSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  twoPhotos: { flexDirection: "column", gap: 10 },
  photoCard: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 8, backgroundColor: "#FFFFFF" },
  photoLabel: { fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 6 },
  photoBox: { height: 330, borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.bg, overflow: "hidden", justifyContent: "center" },
  photoImg: { width: "100%", height: "100%", objectFit: "contain" },
  photoFallback: { fontSize: 10, color: C.muted, textAlign: "center", padding: 10 },
});

function Footer({ periodo }: { periodo: string }) {
  return (
    <View style={S.footer} fixed>
      <Text>META LAV — Prestação de Contas</Text>
      <Text>Competência: {periodo || "—"}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export default function RelatorioFinalPdf(p: Props) {
  const logoUri = p.logo?.data ? imgSrcToDataUri(p.logo as ImageSrcObj) : null;

  const obsRaw = (p.observacoes || "").trim();
  const obsIsEmpty = !obsRaw;
  const obsLong = obsRaw.length > 220; // só cria página extra se realmente precisar

  const geradoEm = (() => {
    const s = (p.gerado_em || "").trim();
    if (!s) return "";
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleString("pt-BR");
    } catch {
      return s;
    }
  })();

  const anexosOk = (p.anexos || []).filter((a) => a && a.tipo);

  return (
    <Document>
      {/* PÁGINA 1 — relatório “grande empresa” */}
      <Page style={S.page} size="A4">
        <View style={S.header}>
          <View style={S.brand}>
            {logoUri ? <Image src={logoUri} style={S.logo} /> : null}
            <View>
              <Text style={S.h1}>Prestação de Contas</Text>
              <Text style={S.h2}>Lavanderia Compartilhada — Relatório final</Text>
            </View>
          </View>

          <View style={S.meta}>
            <Text style={S.metaLabel}>Condomínio</Text>
            <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>

            <View style={{ marginTop: 8 }}>
              <Text style={S.metaLabel}>Competência</Text>
              <Text style={S.metaValue}>{p.periodo || "—"}</Text>
            </View>

            {geradoEm ? (
              <View style={{ marginTop: 8 }}>
                <Text style={S.metaLabel}>Gerado em</Text>
                <Text style={[S.metaValue, { fontSize: 9 }]}>{geradoEm}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={S.grid}>
          {/* COLUNA ESQ: Vendas */}
          <View style={S.col}>
            <View style={S.card}>
              <Text style={S.cardTitle}>Vendas por máquina</Text>
              <Text style={S.cardSub}>Fechamento de caixa por máquina/capacidade</Text>

              <View style={S.table}>
                <View style={S.trH}>
                  <Text style={[S.th, S.cMaquina]}>Máquina</Text>
                  <Text style={[S.th, S.cCiclos, S.right]}>Ciclos</Text>
                  <Text style={[S.th, S.cVU, S.right]}>V. unit.</Text>
                  <Text style={[S.th, S.cRec, S.right]}>Receita</Text>
                </View>

                {(p.vendas || []).map((v, i) => (
                  <View key={i} style={S.tr} wrap={false}>
                    <Text style={[S.td, S.cMaquina]}>{v.maquina || "—"}</Text>
                    <Text style={[S.td, S.cCiclos, S.right]}>{fmtInt(v.ciclos)}</Text>
                    <Text style={[S.td, S.cVU, S.right]}>{brl(v.valor_unitario)}</Text>
                    <Text style={[S.td, S.cRec, S.right, { fontWeight: 700 }]}>{brl(v.valor_total)}</Text>
                  </View>
                ))}
              </View>

              <View style={S.kpiRow}>
                <View style={S.kpi}>
                  <Text style={S.kpiLabel}>Receita Bruta</Text>
                  <Text style={S.kpiValue}>{brl(p.kpis?.receita_bruta)}</Text>
                </View>
                <View style={S.kpi}>
                  <Text style={S.kpiLabel}>Cashback (%)</Text>
                  <Text style={S.kpiValue}>{fmtInt(p.kpis?.cashback_percentual)}%</Text>
                </View>
              </View>

              <View style={[S.kpiRow, { marginTop: 6 }]}>
                <View style={[S.kpi, { flexBasis: "100%" }]}>
                  <Text style={S.kpiLabel}>Valor do Cashback</Text>
                  <Text style={S.kpiValue}>{brl(p.kpis?.cashback_valor)}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* COLUNA DIR: Resumo + Consumo */}
          <View style={S.col}>
            <View style={S.card}>
              <Text style={S.cardTitle}>Resumo financeiro</Text>
              <Text style={S.cardSub}>Consolidação para pagamento</Text>

              <View style={S.miniLine}>
                <Text style={S.miniLabel}>Cashback</Text>
                <Text style={S.miniVal}>{brl(p.total_cashback)}</Text>
              </View>

              <View style={S.miniLine}>
                <Text style={S.miniLabel}>Repasse de consumo</Text>
                <Text style={S.miniVal}>{brl(p.total_consumo)}</Text>
              </View>

              <View style={S.totalBox}>
                <Text style={S.totalLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
                <Text style={S.totalValue}>{brl(p.total_pagar)}</Text>
              </View>

              {/* Observações compactas na mesma página (se não for longa) */}
              {!obsLong ? (
                <View style={S.obsBox}>
                  <Text style={[S.cardTitle, { fontSize: 10 }]}>Observações</Text>
                  <Text style={S.obsText}>{obsIsEmpty ? "—" : obsRaw}</Text>
                </View>
              ) : null}
            </View>

            <View style={S.card}>
              <Text style={S.cardTitle}>Consumo de insumos</Text>
              <Text style={S.cardSub}>Leitura anterior, atual, consumo e repasse</Text>

              <View style={S.table}>
                <View style={S.trH}>
                  <Text style={[S.th, S.cInsumo]}>Insumo</Text>
                  <Text style={[S.th, S.cAnt, S.right]}>Anterior</Text>
                  <Text style={[S.th, S.cAtu, S.right]}>Atual</Text>
                  <Text style={[S.th, S.cCons, S.right]}>Cons.</Text>
                  <Text style={[S.th, S.cRep, S.right]}>Repasse</Text>
                </View>

                {(p.consumos || []).map((c, i) => (
                  <View key={i} style={S.tr} wrap={false}>
                    <Text style={[S.td, S.cInsumo]}>{c.nome || "—"}</Text>
                    <Text style={[S.td, S.cAnt, S.right]}>{fmtLeitura(c.anterior)}</Text>
                    <Text style={[S.td, S.cAtu, S.right]}>{fmtLeitura(c.atual)}</Text>
                    <Text style={[S.td, S.cCons, S.right]}>{fmtInt(c.consumo)}</Text>
                    <Text style={[S.td, S.cRep, S.right, { fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
                  </View>
                ))}
              </View>

              <View style={S.miniLine}>
                <Text style={S.miniLabel}>Total do repasse de consumo</Text>
                <Text style={[S.miniVal, { fontSize: 10 }]}>{brl(p.total_consumo)}</Text>
              </View>
            </View>
          </View>
        </View>

        <Footer periodo={p.periodo || "—"} />
      </Page>

      {/* PÁGINA EXTRA — Observações longas (só se precisar) */}
      {obsLong ? (
        <Page style={S.page} size="A4">
          <View style={S.card}>
            <Text style={S.cardTitle}>Observações</Text>
            <Text style={S.cardSub}>Informações adicionais do fechamento</Text>
            <View style={[S.obsBox, { marginTop: 10 }]}>
              <Text style={S.obsText}>{obsRaw}</Text>
            </View>
          </View>
          <Footer periodo={p.periodo || "—"} />
        </Page>
      ) : null}

      {/* ANEXOS — 2 fotos por página */}
      {chunk(anexosOk, 2).map((pair, pageIdx) => (
        <Page key={`anexos-${pageIdx}`} style={S.page} size="A4">
          <View style={S.anHeader}>
            <View style={S.brand}>
              {logoUri ? <Image src={logoUri} style={S.logo} /> : null}
              <View>
                <Text style={S.anTitle}>Anexos</Text>
                <Text style={S.anSub}>Evidências do fechamento</Text>
              </View>
            </View>

            <View style={S.meta}>
              <Text style={S.metaLabel}>Condomínio</Text>
              <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>
              <View style={{ marginTop: 8 }}>
                <Text style={S.metaLabel}>Competência</Text>
                <Text style={S.metaValue}>{p.periodo || "—"}</Text>
              </View>
            </View>
          </View>

          <View style={S.twoPhotos}>
            {pair.map((a, idx) => {
              const hasImg = Boolean(a?.isImagem && a?.src?.data);
              const uri = hasImg ? imgSrcToDataUri(a.src as ImageSrcObj) : null;

              return (
                <View key={`${pageIdx}-${idx}`} style={S.photoCard}>
                  <Text style={S.photoLabel}>{a.tipo}</Text>
                  <View style={S.photoBox}>
                    {uri ? (
                      <Image src={uri} style={S.photoImg} />
                    ) : (
                      <Text style={S.photoFallback}>
                        Não foi possível incorporar este anexo no PDF.
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <Footer periodo={p.periodo || "—"} />
        </Page>
      ))}
    </Document>
  );
}
