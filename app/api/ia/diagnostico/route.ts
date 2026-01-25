export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

type Role = "auditor" | "interno" | "gestor";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

/**
 * Rate limit simples (best-effort) por userId.
 * Em serverless, pode variar por instância, mas já reduz abuso.
 */
const RL = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const cur = RL.get(key);
  if (!cur || now > cur.resetAt) {
    RL.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  if (cur.count >= max) return { ok: false, remaining: 0, resetAt: cur.resetAt };
  cur.count += 1;
  RL.set(key, cur);
  return { ok: true, remaining: max - cur.count };
}

type DiagnosticoInput = {
  title?: string;              // ex: "PDF anexo não renderiza"
  route?: string;              // ex: "/api/relatorios/.../pdf"
  method?: string;             // "GET" | "POST"...
  when?: string;               // timestamp
  request_id?: string;         // se tiver
  logs?: string;               // runtime logs / stack trace
  code_context?: string;       // trechos relevantes do código
  repro_steps?: string;        // passos pra reproduzir
  expected?: string;           // comportamento esperado
  actual?: string;             // comportamento atual
  env_notes?: string;          // ex: "Vercel prod, supabase storage public"
};

type PatchSuggestion = {
  file?: string;
  description: string;
  diff?: string; // diff em texto
  risk: "low" | "medium" | "high";
  verify: string[]; // checklist de validação
};

type DiagnosticoOutput = {
  summary: string;
  probable_causes: Array<{ cause: string; confidence: number; evidence: string[] }>;
  next_steps: string[];
  suggested_patches: PatchSuggestion[];
  safety_notes: string[];
  meta: { mode: "heuristic" | "ai"; remaining_rate_limit?: number };
};

function clampText(s: any, max = 40_000) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + "\n...[TRUNCADO]" : t;
}

/**
 * Heurísticas úteis (sem IA) para já matar 60% dos bugs comuns.
 * Isso evita “horas no escuro”.
 */
function heuristicDiagnose(input: DiagnosticoInput): DiagnosticoOutput {
  const logs = (input.logs ?? "").toLowerCase();
  const route = (input.route ?? "").toLowerCase();
  const code = (input.code_context ?? "").toLowerCase();

  const causes: DiagnosticoOutput["probable_causes"] = [];
  const patches: PatchSuggestion[] = [];
  const next: string[] = [];

  function addCause(cause: string, confidence: number, evidence: string[]) {
    causes.push({ cause, confidence, evidence });
  }

  // 1) UUID com aspas / encode ruim
  if (logs.includes("invalid input syntax for type uuid") || logs.includes("type uuid")) {
    addCause(
      "ID com aspas/escape/URL mal formada (UUID vindo com caracteres extras).",
      0.85,
      ["Mensagem de erro menciona UUID inválido."]
    );
    patches.push({
      file: "rota que recebe params.id",
      description: "Sanitizar params.id extraindo UUID por regex antes de consultar o banco.",
      risk: "low",
      diff: `// exemplo\nconst m = String(params.id).match(/[0-9a-fA-F-]{36}/);\nconst id = m? m[0] : null;`,
      verify: [
        "Testar URL com espaços/aspas (%20, %22).",
        "Garantir que IDs válidos continuam funcionando.",
      ],
    });
  }

  // 2) Payload grande (fotos)
  if (logs.includes("function_payload_too_large") || logs.includes("request entity too large") || logs.includes("payload too large")) {
    addCause(
      "Upload está enviando arquivo grande demais para a Function (Vercel Function payload limit).",
      0.9,
      ["Erro explícito de payload too large."]
    );
    patches.push({
      file: "rota de upload de fotos",
      description:
        "Fazer upload direto para Supabase Storage via signed URL (ou client upload), evitando passar o binário pela Function.",
      risk: "medium",
      diff:
        "- Em vez de POST com arquivo no /api...\n+ gerar signed upload URL no backend e subir direto do client",
      verify: [
        "Subir uma foto grande (ex: 5–10MB) sem bater no limite.",
        "Checar se o bucket mantém ACL correta (public/privado).",
      ],
    });
  }

  // 3) Sharp/libvips
  if (logs.includes("sharp") || logs.includes("vips_") || logs.includes("libvips") || logs.includes("vips_colourspace")) {
    addCause(
      "Falha no Sharp/libvips ao converter imagem (colorspace/perfil/codec).",
      0.9,
      ["Logs citam vips/sharp (ex: vips_colourspace)."]
    );
    patches.push({
      file: "rota que normaliza imagens (PDF / thumbnails)",
      description:
        "Evitar conversões de colorspace agressivas; regravar como JPEG baseline (não-progressivo) e manter sRGB.",
      risk: "low",
      diff:
        "sharp(buf).rotate().jpeg({ quality:85, progressive:false, mozjpeg:true }).toBuffer()",
      verify: [
        "Rodar ?diag=1 e confirmar anexos ok:true.",
        "Abrir PDF e confirmar que todas as imagens aparecem.",
      ],
    });
  }

  // 4) Auth / permissão / RLS (Row Level Security — políticas de linha)
  if (logs.includes("permission") || logs.includes("rls") || logs.includes("new row violates row-level security") || logs.includes("not authorized") || logs.includes("403")) {
    addCause(
      "Permissão/RLS (Row Level Security — políticas de linha) bloqueando SELECT/INSERT/UPDATE.",
      0.8,
      ["Logs sugerem 403/permission/violação de RLS."]
    );
    next.push("Confirmar role do usuário (auditor/interno/gestor) e quais policies estão ativas.");
    patches.push({
      file: "policies do Supabase",
      description:
        "Ajustar policy para permitir a ação apenas no escopo correto (ex: auditor só na própria auditoria).",
      risk: "high",
      diff: "— (depende das policies atuais)",
      verify: [
        "Testar com auditor, interno e gestor separadamente.",
        "Garantir que auditor NÃO vê auditoria de outro auditor.",
      ],
    });
  }

  // 5) Fetch interno / origem errada
  if (route.includes("/pdf") && (logs.includes("fetch failed") || logs.includes("econnrefused") || logs.includes("invalid url"))) {
    addCause(
      "Falha ao fazer fetch interno (origin errado, header/cookie não encaminhado, URL inválida).",
      0.7,
      ["Logs indicam falha de fetch/URL."]
    );
    next.push("Logar origin calculado + status de cada fetch (JSON e imagens) via ?diag=1.");
  }

  if (causes.length === 0) {
    addCause(
      "Sem sinais suficientes nos logs para causa raiz automática.",
      0.3,
      ["Logs/code_context não trazem erro claro."]
    );
    next.push("Cole o runtime log completo (incluindo stack) e o trecho do arquivo onde ocorreu a exceção.");
  }

  // Ordena por confiança
  causes.sort((a, b) => b.confidence - a.confidence);

  return {
    summary: `Diagnóstico inicial baseado em heurísticas (sem IA). Encontradas ${causes.length} hipóteses.`,
    probable_causes: causes,
    next_steps: [
      "Reproduzir 1 vez com ?diag=1 (quando aplicável) e coletar a resposta completa.",
      "Confirmar stack trace e o ponto exato do código (arquivo + linha).",
      ...next,
    ],
    suggested_patches: patches,
    safety_notes: [
      "Não commitar mudanças grandes sem teste mínimo (smoke test) das rotas críticas.",
      "Evitar logs com secrets (token, cookie, keys).",
    ],
    meta: { mode: "heuristic" },
  };
}

/**
 * Gancho para plugar IA depois (sem quebrar nada agora).
 * Quando você decidir o provedor, eu implemento aqui.
 */
async function aiDiagnose(_input: DiagnosticoInput): Promise<DiagnosticoOutput | null> {
  const provider = process.env.AI_PROVIDER?.toLowerCase()?.trim();
  if (!provider) return null;

  // Placeholder seguro: por enquanto não chama nada.
  // Quando você disser "pluga", eu implemento o provider real (OpenAI/Anthropic/etc).
  return null;
}

export async function POST(req: Request) {
  try {
    const { user, role } = await getUserAndRole();
    if (!user) return bad("Não autenticado", 401);
    if (!roleGte(role as Role, "interno")) return bad("Sem permissão", 403);

    const rl = rateLimit(`diag:${user.id}`, 25, 60_000);
    if (!rl.ok) return bad("Rate limit excedido. Tente novamente em instantes.", 429, { resetAt: rl.resetAt });

    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON inválido");

    const input: DiagnosticoInput = {
      title: clampText(body.title, 200),
      route: clampText(body.route, 500),
      method: clampText(body.method, 20),
      when: clampText(body.when, 80),
      request_id: clampText(body.request_id, 200),
      logs: clampText(body.logs, 80_000),
      code_context: clampText(body.code_context, 80_000),
      repro_steps: clampText(body.repro_steps, 10_000),
      expected: clampText(body.expected, 5_000),
      actual: clampText(body.actual, 5_000),
      env_notes: clampText(body.env_notes, 5_000),
    };

    // 1) tenta IA (se configurada)
    const ai = await aiDiagnose(input);
    if (ai) {
      ai.meta.remaining_rate_limit = rl.remaining;
      return NextResponse.json(ai);
    }

    // 2) fallback heurístico
    const out = heuristicDiagnose(input);
    out.meta.remaining_rate_limit = rl.remaining;
    return NextResponse.json(out);
  } catch (e: any) {
    return bad(e?.message ?? "Erro inesperado", 500);
  }
}
