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

  consumos: Array<{ nome: string; anterior: number; atual: number; consumo: number; valor_total: number }>;
  total_consumo: number;

  total_cashback: number;
  total_pagar: number;

  observacoes?: string;
  anexos: AnexoPdf[];
};

const C = {
  ink: "#0B1F35",
  muted: "#64748B",
  line: "#E2E8F0",
  bg: "#F8FAFC",
};

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function n(v: any) {
  return Number(v || 0).toLocaleString("pt-BR");
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

const S = StyleSheet.create({
  page: { padding: 26, fontSize: 10, fontFamily: "Helvetica", color: C.ink },

  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 42, height: 42, objectFit: "contain" },
  h1: { fontSize: 16, fontWeight: 700 },
  h2: { fontSize: 9, color: C.muted },

  meta: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8, width: 220 },

  section: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginBottom: 10 },
  title: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 9, color: C.muted, marginBottom: 6 },

  table: { borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  rowH: { flexDirection: "row", backgroundColor: C.bg },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line },
  th: { padding: 6, fontWeight: 700 },
  td: { padding: 6 },
  r: { textAlign: "right" },

  totalBox: { backgroundColor: C.ink, borderRadius: 12, padding: 12, marginTop: 6 },
  totalLabel: { color: "#CBD5E1", fontSize: 9 },
  totalValue: { color: "#FFF", fontSize: 18, fontWeight: 700 },

  obs: { fontSize: 9, marginTop: 4 },

  footer: { position: "absolute", bottom: 14, left: 26, right: 26, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, fontSize: 8, color: C.muted, flexDirection: "row", justifyContent: "space-between" },

  anexoBox: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 8, marginBottom: 10 },
  anexoImg: { width: "100%", height: 300, objectFit: "contain" },
});

export default function RelatorioFinalPdf(p: Props) {
  const obs = (p.observacoes || "").trim();
  const obsLong = obs.length > 200;
  const logo = p.logo?.data ? img(p.logo) : null;

  return (
    <Document>
      {/* PÁGINA 1 */}
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <View style={S.brand}>
            {logo && <Image src={logo} style={S.logo} />}
            <View>
              <Text style={S.h1}>Prestação de Contas</Text>
              <Text style={S.h2}>Lavanderia Compartilhada — Relatório final</Text>
            </View>
          </View>
          <View style={S.meta}>
            <Text>Condomínio</Text>
            <Text style={{ fontWeight: 700 }}>{p.condominio.nome}</Text>
            <Text style={{ marginTop: 6 }}>Competência</Text>
            <Text style={{ fontWeight: 700 }}>{p.periodo}</Text>
          </View>
        </View>

        {/* 1. VENDAS */}
        <View style={S.section}>
          <Text style={S.title}>1. Vendas</Text>
          <Text style={S.sub}>Vendas por máquina</Text>

          <View style={S.table}>
            <View style={S.rowH}>
              <Text style={[S.th, { width: "40%" }]}>Máquina</Text>
              <Text style={[S.th, { width: "15%" }, S.r]}>Ciclos</Text>
              <Text style={[S.th, { width: "20%" }, S.r]}>V. unit.</Text>
              <Text style={[S.th, { width: "25%" }, S.r]}>Receita</Text>
            </View>
            {p.vendas.map((v, i) => (
              <View key={i} style={S.row}>
                <Text style={[S.td, { width: "40%" }]}>{v.maquina}</Text>
                <Text style={[S.td, { width: "15%" }, S.r]}>{n(v.ciclos)}</Text>
                <Text style={[S.td, { width: "20%" }, S.r]}>{brl(v.valor_unitario)}</Text>
                <Text style={[S.td, { width: "25%" }, S.r, { fontWeight: 700 }]}>{brl(v.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={{ marginTop: 6 }}>
            Receita bruta: <Text style={{ fontWeight: 700 }}>{brl(p.kpis.receita_bruta)}</Text> · Cashback {p.kpis.cashback_percentual}% (
            {brl(p.kpis.cashback_valor)})
          </Text>
        </View>

        {/* 2. INSUMOS */}
        <View style={S.section}>
          <Text style={S.title}>2. Insumos</Text>
          <View style={S.table}>
            <View style={S.rowH}>
              <Text style={[S.th, { width: "40%" }]}>Insumo</Text>
              <Text style={[S.th, { width: "20%" }, S.r]}>Consumo</Text>
              <Text style={[S.th, { width: "40%" }, S.r]}>Repasse</Text>
            </View>
            {p.consumos.map((c, i) => (
              <View key={i} style={S.row}>
                <Text style={[S.td, { width: "40%" }]}>{c.nome}</Text>
                <Text style={[S.td, { width: "20%" }, S.r]}>{n(c.consumo)}</Text>
                <Text style={[S.td, { width: "40%" }, S.r, { fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>
          <Text style={{ marginTop: 6 }}>
            Total do repasse de consumo: <Text style={{ fontWeight: 700 }}>{brl(p.total_consumo)}</Text>
          </Text>
        </View>

        {/* 3. FINANCEIRO */}
        <View style={S.section}>
          <Text style={S.title}>3. Financeiro</Text>
          <View style={S.totalBox}>
            <Text style={S.totalLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
            <Text style={S.totalValue}>{brl(p.total_pagar)}</Text>
          </View>
        </View>

        {/* 4. OBSERVAÇÕES */}
        <View style={S.section}>
          <Text style={S.title}>4. Observações</Text>
          <Text style={S.obs}>{obs || "—"}</Text>
        </View>

        <View style={S.footer}>
          <Text>META LAV</Text>
          <Text>Competência {p.periodo}</Text>
        </View>
      </Page>

      {/* ANEXOS — 2 POR PÁGINA */}
      {chunk(p.anexos, 2).map((pair, i) => (
        <Page key={i} size="A4" style={S.page}>
          <Text style={S.title}>Anexos</Text>
          {pair.map((a, j) => (
            <View key={j} style={S.anexoBox}>
              <Text style={{ fontWeight: 700, marginBottom: 4 }}>{a.tipo}</Text>
              {a.src && <Image src={img(a.src)} style={S.anexoImg} />}
            </View>
          ))}
          <View style={S.footer}>
            <Text>META LAV</Text>
            <Text>Competência {p.periodo}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}
