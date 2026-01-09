import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "auditorias";

// mapeia "tipo" -> coluna no banco
const kindToColumn: Record<string, string> = {
  agua: "foto_agua_url",
  energia: "foto_energia_url",
  gas: "foto_gas_url",
  quimicos: "foto_quimicos_url",
  bombonas: "foto_bombonas_url",
};

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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase env não configurado (URL ou SERVICE_ROLE_KEY)." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const form = await req.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file") as File | null;

    if (!kind || !kindToColumn[kind]) {
      return NextResponse.json({ error: "Campo 'kind' inválido." }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "Arquivo não enviado (file)." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Envie apenas imagem." }, { status: 400 });
    }

    // lê o arquivo para bytes
    const bytes = new Uint8Array(await file.arrayBuffer());

    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);
    const filename = `${kind}-${Date.now()}-${base}.${ext}`;
    const path = `${auditoriaId}/${filename}`;

    // upload no Storage
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ error: `Erro upload Storage: ${up.error.message}` }, { status: 500 });
    }

    const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.data?.publicUrl;

    if (!publicUrl) {
      return NextResponse.json({ error: "Falha ao obter URL pública." }, { status: 500 });
    }

    // grava URL na auditoria (na coluna correspondente)
    const col = kindToColumn[kind];
    const { data, error } = await supabaseAdmin
      .from("auditorias")
      .update({ [col]: publicUrl })
      .eq("id", auditoriaId)
      .select(
        "id, condominio_id, auditor_id, status, ano_mes, mes_ref, leitura_agua, leitura_energia, leitura_gas, observacoes, foto_agua_url, foto_energia_url, foto_gas_url, foto_quimicos_url, foto_bombonas_url"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: `Erro ao salvar URL no banco: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl, kind, auditoria: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
