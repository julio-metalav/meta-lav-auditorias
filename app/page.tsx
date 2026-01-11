"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { BuildTag } from "@/app/components/BuildTag";


type Role = "auditor" | "interno" | "gestor";
type Me = { user: { id: string; email: string }; role: Role | null };

type Counts = { condominios: number; auditorias: number };

function roleGte(role: Role | null, min: Role) {
  const rank: Record<Role, number> = { auditor: 1, interno: 2, gestor: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<Counts>({ condominios: 0, auditorias: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadAll() {
    setErr(null);
    setLoading(true);

    try {
      const [m, c, a] = await Promise.all([
        fetch("/api/me", { cache: "no-store" }).then((r) => r.json().catch(() => null)),
        fetch("/api/condominios", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/auditorias", { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (m?.user?.id) setMe(m);

      if (c?.error) throw new Error(c.error);
      if (a?.error) throw new Error(a.error);

      setCounts({
        condominios: c?.data?.length ?? 0,
        auditorias: a?.data?.length ?? 0,
      });
    } catch (e: any) {
      setErr(e?.message || "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const role = (me?.role ?? null) as Role | null;
  const isAuditor = role === "auditor" || role === null; // fallback seguro
  const isInterno = roleGte(role, "interno");
  const isGestor = roleGte(role, "gestor");

  const subtitle = useMemo(() => {
    const a = counts.auditorias;
    const c = counts.condominios;
    const perfil = role ? `perfil: ${role}` : "perfil: —";
    return `${perfil} • Base: ${c} condomínio(s) • ${a} auditoria(s)`;
  }, [counts, role]);

  return (
    <AppShell title={isAuditor ? "Início (Auditor)" : "Início"}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div className="small">
          <span className="badge">{subtitle}</span>
          {loading && <span className="badge" style={{ marginLeft: 8 }}>Carregando…</span>}
        </div>

        <button className="btn" onClick={loadAll} disabled={loading}>
          Recarregar
        </button>
      </div>

      {err && <p style={{ color: "#b42318", marginTop: 10 }}>{err}</p>}

      <div style={{ height: 14 }} />

      {/* Auditor: foco em execução de campo */}
      {isAuditor && (
        <div className="list">
          <div className="card" style={{ background: "#fbfcff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Minhas auditorias</div>
                <div className="small">Abrir auditoria, lançar leituras, fotos e concluir em campo.</div>
              </div>
              <Link className="btn" href="/auditorias">
                Abrir
              </Link>
            </div>

            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <span className="badge">Fluxo auditor ✅</span>
              <span className="badge">Upload fotos ✅</span>
              <span className="badge">Conclusão em campo ✅</span>
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700 }}>Checklist rápido (campo)</div>
            <ul className="small" style={{ marginTop: 8, paddingLeft: 18 }}>
              <li>Leituras: água / energia / gás</li>
              <li>Fotos: medidores + proveta + bombonas + conector bala</li>
              <li>Observações (se tiver divergência)</li>
              <li>Concluir → status vai para <b>em_conferencia</b></li>
            </ul>
          </div>
        </div>
      )}

      {/* Interno/Gestor: foco operacional/gestão */}
      {!isAuditor && (
        <div className="list">
          <div className="card" style={{ background: "#fbfcff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Auditorias</div>
                <div className="small">Criar, atribuir, reabrir, acompanhar status e histórico.</div>
              </div>
              <Link className="btn" href="/auditorias">
                Abrir
              </Link>
            </div>

            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <span className="badge">{counts.auditorias} total</span>
              <span className="badge">Reabertura ✅</span>
              <span className="badge">Logs ✅</span>
            </div>
          </div>

          {isInterno && (
            <div className="card" style={{ background: "#fbfcff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Pontos (condomínios)</div>
                  <div className="small">Ver base e cadastrar pontos.</div>
                </div>
                <Link className="btn" href="/condominios">
                  Abrir
                </Link>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span className="badge">{counts.condominios} total</span>
                <span className="badge">Base ✅</span>
              </div>
            </div>
          )}

          {isInterno && (
            <div className="card" style={{ background: "#fbfcff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Atribuições</div>
                  <div className="small">Atribuir auditorias para auditores.</div>
                </div>
                <Link className="btn" href="/atribuicoes">
                  Abrir
                </Link>
              </div>
            </div>
          )}

          <div className="card" style={{ background: "#fbfcff" }}>
            <div style={{ fontWeight: 700 }}>Indicadores (MVP)</div>
            <div className="small" style={{ marginTop: 6 }}>
              Painel gerencial entra depois do relatório simples:
            </div>

            <ul className="small" style={{ marginTop: 10, paddingLeft: 18 }}>
              <li>Receita bruta (ciclos): em breve</li>
              <li>Cashback/repasse: em breve</li>
              <li>Custos variáveis (água/energia/gás/químicos): em breve</li>
              <li>Margem de contribuição: em breve</li>
              <li>Ranking melhores/piores (por máquina/condomínio): em breve</li>
            </ul>
          </div>

          {isGestor && (
            <div className="card" style={{ background: "#fbfcff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Relatórios</div>
                  <div className="small">Relatórios sensíveis e PDF (gestor).</div>
                </div>
                <Link className="btn" href="/relatorios">
                  Abrir
                </Link>
              </div>
            </div>
          )}

          <div className="card" style={{ background: "#ffffff" }}>
            <div style={{ fontWeight: 700 }}>Próximo passo do MVP</div>
            <p className="small" style={{ marginTop: 6 }}>
              Interno fecha a auditoria com ciclos por máquina + comprovante de cashback/repasse.
              Depois: relatório simples (visualização) e PDF (opcional).
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
