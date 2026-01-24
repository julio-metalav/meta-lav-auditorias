"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor" | null;

type Me = {
  user: { id: string; email: string };
  role: Role;
};

type Aud = {
  id: string;
  condominio_id: string;
  mes_ref?: string | null;
  ano_mes?: string | null; // compat
  status: string | null;
  auditor_id: string | null;

  condominios?: { id?: string; nome: string; cidade: string; uf: string } | null;
  profiles?: { id?: string; email?: string | null; role?: string | null } | null;
};

type Filtro = "a_fazer" | "concluidas" | "todas";

function pickMonth(a: Aud) {
  return (a.mes_ref ?? a.ano_mes ?? "") as string;
}

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  const txt = await res.text().catch(() => "");
  if (!txt) return {};
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(txt);
    } catch {
      return { _raw: txt };
    }
  }
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function isConcluida(status: any) {
  return norm(status) === "final";
}

// ===== Relatório financeiro (PDF/XLSX) =====
function monthISOFromDateInput(v: string) {
  const s = String(v ?? "").trim(); // "YYYY-MM"
  if (!/^\d{4}-\d{2}$/.test(s)) return "";
  return `${s}-01`;
}

function monthInputFromISO(v: string) {
  const s = String(v ?? "").trim(); // "YYYY-MM-01"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s.slice(0, 7);
}

function currentMonthISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function currentMonthInputValue() {
  return currentMonthISO().slice(0, 7); // "YYYY-MM"
}

// ✅ regra do mês padrão da LISTA
// dia 1..10 => mês anterior
// dia 11..31 => mês atual
function defaultListMonthISO() {
  const d = new Date();
  const day = d.getDate();
  const base = day <= 10 ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : new Date(d.getFullYear(), d.getMonth(), 1);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function statusPillClass(st: any) {
  const done = isConcluida(st);
  return [
    "inline-flex rounded-full border px-2 py-1 text-xs whitespace-nowrap",
    done ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-700",
  ].join(" ");
}

function getMesRefFromUrl(): string | null {
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("mes_ref");
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    return null;
  } catch {
    return null;
  }
}

function setMesRefInUrl(mesRef: string) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("mes_ref", mesRef);
    window.history.replaceState({}, "", u.toString());
  } catch {
    // ignore
  }
}

export default function AuditoriasPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [auditorias, setAuditorias] = useState<Aud[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  // mês do relatório (apenas interno/gestor)
  const [mesRelatorio, setMesRelatorio] = useState<string>(currentMonthInputValue());

  // ✅ mês da LISTA (sempre filtra a listagem)
  const [mesLista, setMesLista] = useState<string>(() => monthInputFromISO(defaultListMonthISO()) || currentMonthInputValue());

  const didInitFromUrl = useRef(false);

  const mesRefLista = useMemo(() => {
    const iso = monthISOFromDateInput(mesLista);
    return iso || defaultListMonthISO();
  }, [mesLista]);

  async function carregarMe() {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const meJson = await safeJson(meRes);
    if (!meRes.ok) throw new Error((meJson as any)?.error ?? "Erro ao identificar usuário");
    setMe(meJson as Me);
  }

  async function carregarAuditorias(mesRef: string) {
    const url = `/api/auditorias?mes_ref=${encodeURIComponent(mesRef)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await safeJson(res);
    if (!res.ok) throw new Error((json as any)?.error ?? "Erro ao carregar auditorias");

    const list: Aud[] = Array.isArray(json) ? (json as Aud[]) : ((json as any)?.data ?? []);
    setAuditorias(Array.isArray(list) ? list : []);
  }

  async function carregar() {
    setLoading(true);
    setErr(null);
    try {
      if (!me?.role) {
        await carregarMe();
      }

      await carregarAuditorias(mesRefLista);

      // ✅ mantém a URL “travada” no mês atual da tela
      setMesRefInUrl(mesRefLista);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao carregar");
      setAuditorias([]);
    } finally {
      setLoading(false);
    }
  }

  // init: lê mes_ref da URL (se existir) só depois do mount
  useEffect(() => {
    if (didInitFromUrl.current) return;
    didInitFromUrl.current = true;

    const urlMesRef = getMesRefFromUrl();
    if (urlMesRef) {
      const inp = monthInputFromISO(urlMesRef);
      if (inp) setMesLista(inp);
    }
    // não chama carregar aqui; deixa o effect abaixo (mesRefLista) disparar
  }, []);

  // quando muda o mês da lista, recarrega
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesRefLista]);

  const isStaff = useMemo(() => me?.role === "interno" || me?.role === "gestor", [me?.role]);
  const meLoaded = !!me?.role;

  const auditoriasFiltradas = useMemo(() => {
    const qq = norm(q);
    let list = [...auditorias];

    if (filtro === "a_fazer") list = list.filter((a) => !isConcluida(a.status));
    if (filtro === "concluidas") list = list.filter((a) => isConcluida(a.status));

    if (qq) {
      list = list.filter((a) => {
        const condo = a.condominios ? `${a.condominios.nome} ${a.condominios.cidade} ${a.condominios.uf}` : "";
        const auditor = a.profiles?.email ?? "";
        const month = pickMonth(a);
        const id = a.id ?? "";
        const condId = a.condominio_id ?? "";
        const hay = norm(`${condo} ${auditor} ${month} ${id} ${condId} ${a.status ?? ""}`);
        return hay.includes(qq);
      });
    }

    // como a API já filtra por mês, aqui só ordena por condomínio (fallback por mês)
    list.sort((a, b) => {
      const am = pickMonth(a);
      const bm = pickMonth(b);
      if (am !== bm) return String(bm).localeCompare(String(am));
      const an = a.condominios?.nome ?? "";
      const bn = b.condominios?.nome ?? "";
      return String(an).localeCompare(String(bn));
    });

    return list;
  }, [auditorias, filtro, q]);

  function hrefAbrir(a: Aud) {
    if (me?.role === "auditor") return `/auditor/auditoria/${a.id}`;
    return `/interno/auditoria/${a.id}`;
  }

  const mesRefRelatorio = useMemo(() => {
    return monthISOFromDateInput(mesRelatorio) || currentMonthISO();
  }, [mesRelatorio]);

  return (
    <AppShell title="Auditorias">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:p-6">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Auditorias</h1>
            <div className="mt-1 text-sm text-gray-600">
              {me?.role === "auditor" ? "Minhas auditorias (auditor)" : "Lista (interno/gestor)"}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Debug: carregadas {auditorias.length} auditorias • no filtro {auditoriasFiltradas.length} • mes_ref {mesRefLista}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start sm:justify-end">
            {/* ✅ Seletor do mês da LISTA (para todos) */}
            <div className="flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 sm:w-auto">
              <span className="text-xs text-gray-600 whitespace-nowrap">Mês (lista):</span>
              <input
                type="month"
                className="w-full text-sm outline-none sm:w-auto"
                value={mesLista}
                onChange={(e) => setMesLista(e.target.value)}
                title="Escolha o mês que deseja listar"
              />
            </div>

            {/* ✅ Botões e seletor APENAS para interno/gestor (e só depois do /api/me carregar) */}
            {meLoaded && isStaff && (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <button
                  className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50 sm:w-auto"
                  onClick={() => router.push("/auditorias/nova")}
                  disabled={loading}
                  title="Criar nova auditoria"
                >
                  + Nova auditoria
                </button>

                <div className="flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 sm:w-auto">
                  <span className="text-xs text-gray-600 whitespace-nowrap">Relatório:</span>
                  <input
                    type="month"
                    className="w-full text-sm outline-none sm:w-auto"
                    value={mesRelatorio}
                    onChange={(e) => setMesRelatorio(e.target.value)}
                    title="Escolha o mês do relatório"
                  />
                </div>

                <a
                  className="w-full rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 sm:w-auto"
                  href={`/api/relatorios/financeiro/export/xlsx?mes_ref=${encodeURIComponent(mesRefRelatorio)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Baixar relatório financeiro em Excel"
                >
                  Baixar Excel
                </a>

                <a
                  className="w-full rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 sm:w-auto"
                  href={`/api/relatorios/financeiro/export/pdf?mes_ref=${encodeURIComponent(mesRefRelatorio)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Baixar relatório financeiro em PDF"
                >
                  Baixar PDF
                </a>
              </div>
            )}

            <button
              className="w-full rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
              onClick={carregar}
              disabled={loading}
              title="Recarregar"
            >
              {loading ? "Carregando..." : "Recarregar"}
            </button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        {/* Filtros */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <input
            className="w-full rounded-xl border px-4 py-2 text-sm sm:max-w-md"
            placeholder="Buscar condomínio, auditor, ID..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="w-full rounded-xl border px-4 py-2 text-sm sm:w-auto"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
          >
            <option value="a_fazer">A fazer</option>
            <option value="concluidas">Concluídas</option>
            <option value="todas">Todas</option>
          </select>
        </div>

        {/* ✅ MOBILE: Cards */}
        <div className="space-y-3 sm:hidden">
          {auditoriasFiltradas.length === 0 && (
            <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
          )}

          {auditoriasFiltradas.map((a) => {
            const c = a.condominios;
            const condoLabel = c ? `${c.nome} - ${c.cidade}/${c.uf}` : a.condominio_id;
            const month = pickMonth(a) || "—";
            const st = a.status ?? "—";
            const auditorEmail = a.profiles?.email ?? "—";

            return (
              <div key={a.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{condoLabel}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      ID: <span className="font-mono">{a.id}</span>
                    </div>
                  </div>
                  <span className={statusPillClass(st)}>{st}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Mês</div>
                    <div className="font-medium">{month}</div>
                  </div>
                  <div className="rounded-xl border bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Auditor</div>
                    <div className="font-medium truncate">{auditorEmail}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <Link
                    href={hrefAbrir(a)}
                    className="inline-flex w-full items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    title="Abrir auditoria"
                  >
                    Abrir
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* ✅ DESKTOP (sm+): Tabela atual (mantida) */}
        <div className="hidden overflow-hidden rounded-2xl border bg-white shadow-sm sm:block">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <div className="col-span-5">Condomínio</div>
            <div className="col-span-2">Mês</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Auditor</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>

          <div className="divide-y">
            {auditoriasFiltradas.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-600">Nenhuma auditoria no filtro.</div>
            )}

            {auditoriasFiltradas.map((a) => {
              const c = a.condominios;
              const condoLabel = c ? `${c.nome} - ${c.cidade}/${c.uf}` : a.condominio_id;
              const month = pickMonth(a) || "—";
              const st = a.status ?? "—";
              const auditorEmail = a.profiles?.email ?? "—";

              return (
                <div key={a.id} className="grid grid-cols-12 items-center px-4 py-3 text-sm">
                  <div className="col-span-5 min-w-0">
                    <div className="font-medium truncate">{condoLabel}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      ID: <span className="font-mono">{a.id}</span>
                    </div>
                  </div>

                  <div className="col-span-2 text-gray-800">{month}</div>

                  <div className="col-span-2">
                    <span className={statusPillClass(st)}>{st}</span>
                  </div>

                  <div className="col-span-2 truncate text-gray-700">{auditorEmail}</div>

                  <div className="col-span-1 flex justify-end">
                    <Link
                      href={hrefAbrir(a)}
                      className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 whitespace-nowrap"
                      title="Abrir auditoria"
                    >
                      Abrir
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-700">
          <b>Obs:</b>
          <br />
          Auditor faz campo (leituras/fotos) e conclui. Interno lança ciclos, gera relatório financeiro e anexa comprovante.
        </div>
      </div>
    </AppShell>
  );
}
