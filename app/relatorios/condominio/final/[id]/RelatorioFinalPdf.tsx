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

  // ✅ agora vamos renderizar anterior/atual/consumo/repasse como era antes
  consumos: Array<{
    nome: string;
    anterior: number;
    atual: number;
    consumo: number;
    valor_total: number;
  }>;
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
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
}
function leitura(v: any) {
  // leitura pode vir 0 ou null; 0 é válido.
  if (v === null || v === undefined) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("pt-BR") : "—";
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
function toPtBrDateTime(s?: string) {
  const t = String(s || "").trim();
  if (!t) return "";
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleString("pt-BR");
  } catch {
    return t;
  }
}

const S = StyleSheet.create({
  page: { padding: 26, fontSize: 10, fontFamily: "Helvetica", color: C.ink },

  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 330 },
  // ✅ logo proporcional e “corporativa”
  logo: { width: 64, height: 32, objectFit: "contain" },
  brandFallback: { fontSize: 14, fontWeight: 700, letterSpacing: 0.2 },
  h1: { fontSize: 16, fontWeight: 700 },
  h2: { fontSize: 9, color: C.muted },

  meta: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8, width: 230, backgroundColor: "#FFF" },
  metaLabel: { fontSize: 8, color: C.muted },
  metaValue: { fontSize: 10, fontWeight: 700, marginTop: 2 },

  section: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginBottom: 10, backgroundColor: "#FFF" },
  title: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 9, color: C.muted, marginBottom: 6 },

  table: { borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  rowH: { flexDirection: "row", backgroundColor: C.bg },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line },
  th: { padding: 6, fontWeight: 700, fontSize: 9 },
  td: { padding: 6, fontSize: 9 },
  r: { textAlign: "right" },

  totalBox: { backgroundColor: C.ink, borderRadius: 12, padding: 12, marginTop: 6 },
  totalLabel: { color: "#CBD5E1", fontSize: 9 },
  totalValue: { color: "#FFF", fontSize: 18, fontWeight: 700 },

  obs: { fontSize: 9, marginTop: 4 },

  footer: { position: "absolute", bottom: 14, left: 26, right: 26, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, fontSize: 8, color: C.muted, flexDirection: "row", justifyContent: "space-between" },

  anexoBox: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 8, marginBottom: 10, backgroundColor: "#FFF" },
  anexoImg: { width: "100%", height: 300, objectFit: "contain" },
});

export default function RelatorioFinalPdf(p: Props) {
  const obs = (p.observacoes || "").trim();
  const obsCompact = obs ? (obs.length > 220 ? obs.slice(0, 217) + "…" : obs) : "—";
  const geradoEm = toPtBrDateTime(p.gerado_em);

  const logoUri = p.logo?.data ? img(p.logo) : null;

  return (
    <Document>
      {/* PÁGINA 1 */}
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <View style={S.brand}>
            {logoUri ? (
              <Image src={logoUri} style={S.logo} />
            ) : (
              <Text style={S.brandFallback}>META LAV</Text>
            )}
            <View>
              <Text style={S.h1}>Prestação de Contas</Text>
              <Text style={S.h2}>Lavanderia Compartilhada — Relatório final</Text>
            </View>
          </View>

          <View style={S.meta}>
            <Text style={S.metaLabel}>Condomínio</Text>
            <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>

            <View style={{ marginTop: 6 }}>
              <Text style={S.metaLabel}>Competência</Text>
              <Text style={S.metaValue}>{p.periodo || "—"}</Text>
            </View>

            {geradoEm ? (
              <View style={{ marginTop: 6 }}>
                <Text style={S.metaLabel}>Gerado em</Text>
                <Text style={[S.metaValue, { fontSize: 9 }]}>{geradoEm}</Text>
              </View>
            ) : null}
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
              <View key={i} style={S.row} wrap={false}>
                <Text style={[S.td, { width: "40%" }]}>{v.maquina || "—"}</Text>
                <Text style={[S.td, { width: "15%" }, S.r]}>{n(v.ciclos)}</Text>
                <Text style={[S.td, { width: "20%" }, S.r]}>{brl(v.valor_unitario)}</Text>
                <Text style={[S.td, { width: "25%" }, S.r, { fontWeight: 700 }]}>{brl(v.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={{ marginTop: 6, fontSize: 9 }}>
            Receita bruta: <Text style={{ fontWeight: 700 }}>{brl(p.kpis.receita_bruta)}</Text>{" "}
            · Cashback: <Text style={{ fontWeight: 700 }}>{n(p.kpis.cashback_percentual)}%</Text>{" "}
            ({brl(p.kpis.cashback_valor)})
          </Text>
        </View>

        {/* 2. INSUMOS — ✅ volta com anterior/atual/consumo/repasse + total */}
        <View style={S.section}>
          <Text style={S.title}>2. Insumos</Text>
          <Text style={S.sub}>Leitura anterior, leitura atual, consumo e repasse</Text>

          <View style={S.table}>
            <View style={S.rowH}>
              <Text style={[S.th, { width: "26%" }]}>Insumo</Text>
              <Text style={[S.th, { width: "18%" }, S.r]}>Anterior</Text>
              <Text style={[S.th, { width: "18%" }, S.r]}>Atual</Text>
              <Text style={[S.th, { width: "14%" }, S.r]}>Consumo</Text>
              <Text style={[S.th, { width: "24%" }, S.r]}>Repasse</Text>
            </View>

            {p.consumos.map((c, i) => (
              <View key={i} style={S.row} wrap={false}>
                <Text style={[S.td, { width: "26%" }]}>{c.nome || "—"}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.anterior)}</Text>
                <Text style={[S.td, { width: "18%" }, S.r]}>{leitura(c.atual)}</Text>
                <Text style={[S.td, { width: "14%" }, S.r]}>{n(c.consumo)}</Text>
                <Text style={[S.td, { width: "24%" }, S.r, { fontWeight: 700 }]}>{brl(c.valor_total)}</Text>
              </View>
            ))}
          </View>

          <Text style={{ marginTop: 6, fontSize: 9 }}>
            Total do repasse de consumo: <Text style={{ fontWeight: 700 }}>{brl(p.total_consumo)}</Text>
          </Text>
        </View>

        {/* 3. FINANCEIRO */}
        <View style={S.section}>
          <Text style={S.title}>3. Financeiro</Text>

          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 9 }}>
              Cashback: <Text style={{ fontWeight: 700 }}>{brl(p.total_cashback)}</Text>{" "}
              · Repasse de consumo: <Text style={{ fontWeight: 700 }}>{brl(p.total_consumo)}</Text>
            </Text>
          </View>

          <View style={S.totalBox}>
            <Text style={S.totalLabel}>TOTAL A PAGAR AO CONDOMÍNIO</Text>
            <Text style={S.totalValue}>{brl(p.total_pagar)}</Text>
          </View>
        </View>

        {/* 4. OBSERVAÇÕES — compacto */}
        <View style={S.section}>
          <Text style={S.title}>4. Observações</Text>
          <Text style={S.obs}>{obsCompact}</Text>
        </View>

        <View style={S.footer}>
          <Text>META LAV</Text>
          <Text>Competência {p.periodo || "—"}</Text>
        </View>
      </Page>

      {/* ANEXOS — 2 POR PÁGINA */}
      {chunk(p.anexos || [], 2).map((pair, i) => (
        <Page key={i} size="A4" style={S.page}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <View style={S.brand}>
              {logoUri ? <Image src={logoUri} style={S.logo} /> : <Text style={S.brandFallback}>META LAV</Text>}
              <View>
                <Text style={[S.h1, { fontSize: 14 }]}>Anexos</Text>
                <Text style={S.h2}>Evidências do fechamento</Text>
              </View>
            </View>
            <View style={S.meta}>
              <Text style={S.metaLabel}>Condomínio</Text>
              <Text style={S.metaValue}>{p.condominio?.nome || "—"}</Text>
              <View style={{ marginTop: 6 }}>
                <Text style={S.metaLabel}>Competência</Text>
                <Text style={S.metaValue}>{p.periodo || "—"}</Text>
              </View>
            </View>
          </View>

          {pair.map((a, j) => (
            <View key={j} style={S.anexoBox}>
              <Text style={{ fontWeight: 700, marginBottom: 4, fontSize: 10 }}>{a.tipo}</Text>
              {a?.src?.data ? (
                <Image src={img(a.src as ImageSrcObj)} style={S.anexoImg} />
              ) : (
                <Text style={{ color: C.muted, fontSize: 9 }}>
                  Não foi possível incorporar este anexo no PDF.
                </Text>
              )}
            </View>
          ))}

          <View style={S.footer}>
            <Text>META LAV</Text>
            <Text>Competência {p.periodo || "—"}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}
