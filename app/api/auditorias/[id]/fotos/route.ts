import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

const BUCKET = "auditorias";

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos"
  | "proveta"
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

function isProveta(kind: string) {
  return kind === "proveta";
}

function folderFor(kind: string) {
  if (isComprovante(kind)) return "fechamento";
  if (isProveta(kind)) return "provetas";
  return "fotos";
}

function extFromFileName(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop()! : "bin";
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
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

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

function toInt(v: any): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toText(v: any, max = 80): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auditoriaId = params.id;

    const supabase = supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const role = await getRole(supabase);
    if (!role) {
      return NextResponse.json({ error: "Sem role." }, { status: 403 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Env Supabase não configurado." }, { status: 500 });
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const form = await req.formData();

    const kind = String(form.get("kind") ?? "");
    const file = form.get("file") as File | null;

    const maquinaId = toText(form.get("maquina_id"), 36);
    const maquinaIdx = toInt(form.get("maquina_idx"));
    const maquinaTag = toText(form.get("maquina_tag")) ?? "lavadora";

    if (!kind || !file) {
      return NextResponse.json({ error: "kind e file são obrigatórios." }, { status: 400 });
    }

    const okKinds: FotoKind[] = [
      "agua",
      "energia",
      "gas",
      "quimicos",
      "proveta",
      "bombonas",
      "conector_bala",
      "comprovante_fechamento",
    ];

    if (!okKinds.includes(kind as FotoKind)) {
      return NextResponse.json({ error: "kind inválido." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Envie apenas imagem." }, { status: 400 });
    }

    if (isProveta(kind)) {
      if (!maquinaId) {
        return NextResponse.json({ error: "maquina_id é obrigatório para proveta." }, { status: 400 });
      }
      if (!maquinaIdx || maquinaIdx < 1) {
        return NextResponse.json({ error: "maquina_idx inválido." }, { status: 400 });
      }
    }

    const { data: aud } = await admin
      .from("auditorias")
      .select("id,auditor_id,status")
      .eq("id", auditoriaId)
      .single();

    if (!aud) {
      return NextResponse.json({ error: "Auditoria não encontrada." }, { status: 404 });
    }

    const statusAtual = normalizeStatus(aud.status);
    const isStaff = role === "interno" || role === "gestor";

    if (
      role === "auditor" &&
      !isStaff &&
      !isComprovante(kind) &&
      (statusAtual === "em_conferencia" || statusAtual === "final")
    ) {
      return NextResponse.json(
        { error: "Auditor não pode alterar fotos após conferência/final." },
        { status: 403 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);
    const stamp = Date.now();

    const filename = isProveta(kind)
      ? `proveta-idx${maquinaIdx}-${stamp}-${base}.${ext}`
      : `${kind}-${stamp}-${base}.${ext}`;

    const path = `${auditoriaId}/${folderFor(kind)}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const fotoUrl = pub?.publicUrl;
    if (!fotoUrl) {
      return NextResponse.json({ error: "Falha ao gerar URL pública." }, { status: 500 });
    }

    // ===== PROVETA (SEM ADIVINHAÇÃO) =====
    if (isProveta(kind)) {
      const { error } = await admin
        .from("auditoria_provetas")
        .upsert(
          {
            auditoria_id: auditoriaId,
            maquina_id: maquinaId,
            maquina_tag: maquinaTag,
            maquina_idx: maquinaIdx,
            foto_url: fotoUrl,
          },
          { onConflict: "auditoria_id,maquina_tag,maquina_idx" }
        );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        kind,
        maquina_id: maquinaId,
        maquina_idx: maquinaIdx,
        foto_url: fotoUrl,
      });
    }

    // ===== LEGADO =====
    const col = kindToColumn(kind);
    if (!col) {
      return NextResponse.json({ error: "kind não mapeado." }, { status: 400 });
    }

    const { error } = await admin
      .from("auditorias")
      .update({ [col]: fotoUrl })
      .eq("id", auditoriaId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, kind, url: fotoUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado." }, { status: 500 });
  }
}
