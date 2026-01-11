import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BUCKET do Supabase Storage (onde as fotos ficam)
const BUCKET = "auditorias";

type Role = "auditor" | "interno" | "gestor";
type Status = "aberta" | "em_andamento" | "em_conferencia" | "final";

// Mapeia o tipo de foto ("kind") para a coluna na tabela auditorias
const kindToColumn: Record<string, string> = {
  agua: "foto_agua_url",
  energia: "foto_energia_url",
  gas: "foto_gas_url",
  quimicos: "foto_quimicos_url",
  bombonas: "foto_bombonas_url",
  conector_bala: "foto_conector_bala_url",
};

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof, error } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if (error) return null;

  return (prof?.role ?? null) as Role | null;
}

function normalizeStatus(input: any): Status {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferencia" || s === "em_conferencia") return "em_conferencia";
  if (s === "em andamento" || s === "em_andamento") return "em_andamento";
  if (s === "final") return "final";
  return "aberta";
}

function extFromFileName(name: string) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "jpg";
  return ext.replace(/[^a-z0-9]/g, "") || "jpg";
}

function safeFileBase(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]/g, "")
    .slice(0, 60);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auditoriaId = params.id;

    // Cliente server (usa cookie do usuário logado)
    const supabase = supabaseServer();

    // 1) login obrigatório
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    // 2) role do usuário (auditor/interno/gestor)
    const role = await getRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role." }, { status: 403 });

    // 3) Admin client (service role) para upload e update sem depender de RLS
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase env não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 4) Carrega auditoria (precisa status + auditor_id pra regra de permissão)
    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id,auditor_id,status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada." }, { status: 404 });
    }

    const statusAtual = normalizeStatus(aud.status);
    const isStaff = role === "interno" || role === "gestor";
    const isOwnerAuditor = role === "auditor" && aud.auditor_id === user.id;

    // Permissão base
    if (!isStaff && !isOwnerAuditor) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    // Auditor NÃO pode alterar após em_conferencia/final
    if (role === "auditor" && !isStaff && (statusAtual === "em_conferencia" || statusAtual === "final")) {
      return NextResponse.json({ error: "Auditor não pode alterar fotos após em_conferencia/final." }, { status: 403 });
    }

    // 5) FormData: kind + file
    const form = await req.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file") as File | null;

    if (!kind || !kindToColumn[kind]) {
      return NextResponse.json({ error: "Campo 'kind' inválido." }, { status: 400 });
    }
    if (!file) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Envie apenas imagem." }, { status: 400 });
    }

    // 6) Upload no Storage
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);
    const filename = `${kind}-${Date.now()}-${base}.${ext}`;
    const path = `${auditoriaId}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // 7) Salva URL na coluna certa em auditorias
    const col = kindToColumn[kind];

    // Retornamos SEMPRE no formato esperado pelo front: { auditoria: {...} }
    // (mesmo que seja só a coluna atualizada).
    const { data: updatedRow, error: updErr } = await admin
      .from("auditorias")
      .update({ [col]: publicUrl })
      .eq("id", auditoriaId)
      .select(`${col}`)
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      kind,
      url: publicUrl,
      auditoria: updatedRow, // ✅ o front do auditor espera isso
      updated: updatedRow, // ✅ compat (se alguém já usa)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
