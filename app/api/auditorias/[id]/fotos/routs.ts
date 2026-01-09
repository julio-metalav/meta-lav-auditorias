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
  conector_bala: "foto_conector_bala_url",
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
        { error: "Supabase env não configurado." },
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
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Envie apenas imagem." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);
    const filename = `${kind}-${Date.now()}-${base}.${ext}`;
    const path = `${auditoriaId}/${filename}`;

    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const col = kindToColumn[kind];
    const { data, error } = await supabaseAdmin
      .from("auditorias")
      .update({ [col]: publicUrl })
      .eq("id", auditoriaId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl, kind, auditoria: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
