import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import sharp from "sharp";

type Role = "auditor" | "interno" | "gestor";

const BUCKET = "auditorias";

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos"
  | "bombonas"
  | "conector_bala"
  | "comprovante_fechamento";

function normalizeStatus(input: any) {
  const s = String(input ?? "aberta").trim().toLowerCase();
  if (s === "em conferência" || s === "em conferencia") return "em_conferencia";
  if (s === "em andamento") return "em_andamento";
  if (s === "finalizado") return "final";
  if (s === "aberto") return "aberta";
  return s || "aberta";
}

function isComprovante(kind: string) {
  return kind === "comprovante_fechamento";
}

function folderFor(kind: string) {
  return isComprovante(kind) ? "fechamento" : "fotos";
}

function extFromMime(mime: string) {
  if (mime.includes("png")) return "png";
  return "jpg";
}

function safeFileBase(name: string) {
  return (
    name
      .replace(/\.[^/.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "file"
  );
}

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (prof?.role ?? null) as Role | null;
}

function kindToColumn(kind: string) {
  const map: Record<string, string> = {
    agua: "foto_agua_url",
    energia: "foto_energia_url",
    gas: "foto_gas_url",
    quimicos: "foto_quimicos_url",
    bombonas: "foto_bombonas_url",
    conector_bala: "foto_conector_bala_url",
    comprovante_fechamento: "comprovante_fechamento_url",
  };
  return map[kind] ?? null;
}

// proveta / proveta_1 / proveta2 / proveta-2
function parseProvetaKind(kindRaw: string): { tag: string; idx: number } | null {
  const k = String(kindRaw ?? "").trim().toLowerCase();
  if (!k) return null;
  if (k === "proveta") return { tag: "proveta_1", idx: 1 };
  const m = /^proveta(?:[_-]?)(\d+)$/.exec(k);
  if (!m) return null;
  const idx = Number(m[1]);
  if (!Number.isFinite(idx) || idx <= 0) return null;
  return { tag: `proveta_${idx}`, idx };
}

async function normalizeImage(file: File): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const input = Buffer.from(await file.arrayBuffer());

  const out = await sharp(input, { failOnError: false })
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return {
    buffer: out,
    mime: "image/jpeg",
    ext: "jpg",
  };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auditoriaId = params.id;

    const supabase = supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const role = await getRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role." }, { status: 403 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Supabase env não configurado." }, { status: 500 });
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const form = await req.formData();
    const kind = String(form.get("kind") ?? "").trim();
    const file = form.get("file") as File | null;

    if (!kind) return NextResponse.json({ error: "kind é obrigatório." }, { status: 400 });
    if (!file) return NextResponse.json({ error: "file é obrigatório." }, { status: 400 });

    const proveta = parseProvetaKind(kind);
    const isProveta = !!proveta;

    const okKinds: FotoKind[] = [
      "agua",
      "energia",
      "gas",
      "bombonas",
      "conector_bala",
      "comprovante_fechamento",
    ];

    if (!okKinds.includes(kind as FotoKind) && !isProveta) {
      return NextResponse.json({ error: `kind inválido: ${kind}` }, { status: 400 });
    }

    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id,condominio_id,auditor_id,status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });
    }

    const statusAtual = normalizeStatus(aud.status);
    const isStaff = role === "interno" || role === "gestor";
    const isOwnerAuditor = role === "auditor" && aud.auditor_id === user.id;
    const isUnassigned = !aud.auditor_id;

    if (!isStaff && !isOwnerAuditor && !isUnassigned) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    if (
      role === "auditor" &&
      !isStaff &&
      !isComprovante(kind) &&
      (statusAtual === "em_conferencia" || statusAtual === "final")
    ) {
      return NextResponse.json({ error: "Auditor não pode alterar após conferência/final." }, { status: 403 });
    }

    const normalized = await normalizeImage(file);
    const base = safeFileBase(file.name);
    const filename = `${kind}-${Date.now()}-${base}.${normalized.ext}`;
    const storagePath = `${auditoriaId}/${folderFor(kind)}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(storagePath, normalized.buffer, {
      contentType: normalized.mime,
      upsert: true,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    if (!pub?.publicUrl) {
      return NextResponse.json({ error: "Falha ao obter URL pública." }, { status: 500 });
    }

    if (isProveta && proveta) {
      const { error } = await admin
        .from("auditoria_provetas")
        .upsert(
          {
            auditoria_id: auditoriaId,
            maquina_tag: proveta.tag,
            maquina_idx: proveta.idx,
            foto_url: pub.publicUrl,
          },
          { onConflict: "auditoria_id,maquina_tag" }
        );

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, kind: proveta.tag, url: pub.publicUrl });
    }

    const col = kindToColumn(kind);
    if (!col) return NextResponse.json({ error: "kind não mapeado." }, { status: 400 });

    const patch: any = { [col]: pub.publicUrl };

    if (!isStaff && role === "auditor" && isUnassigned) {
      const { data, error } = await admin
        .from("auditorias")
        .update({ ...patch, auditor_id: user.id })
        .eq("id", auditoriaId)
        .is("auditor_id", null)
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "auditoria_ja_assumida" }, { status: 409 });
    } else {
      const { error } = await admin
        .from("auditorias")
        .update(patch)
        .eq("id", auditoriaId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, kind, url: pub.publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
