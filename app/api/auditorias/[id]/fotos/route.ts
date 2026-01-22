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

function extFromFileName(name: string) {
  const n = name.toLowerCase();
  const parts = n.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "bin";
  return ext.replace(/[^a-z0-9]/g, "") || "bin";
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

function toShortText(v: any, max = 800) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
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
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file") as File | null;
    const mime = file?.type ?? "";
    const fechamentoObs = toShortText(form.get("fechamento_obs"));

    if (!kind) return NextResponse.json({ error: "kind é obrigatório." }, { status: 400 });
    if (!file) return NextResponse.json({ error: "file é obrigatório." }, { status: 400 });

    // aceita proveta_1, proveta_2, etc
    const isProveta = /^proveta_\d+$/.test(kind);

    // okKinds SEM "quimicos" (proveta é quem cobre o químico por lavadora)
    const okKinds: FotoKind[] = [
      "agua",
      "energia",
      "gas",
      "bombonas",
      "conector_bala",
      "comprovante_fechamento",
    ];

    if (!okKinds.includes(kind as FotoKind) && !isProveta) {
      return NextResponse.json({ error: "kind inválido." }, { status: 400 });
    }

    // 🔒 REGRA DEFINITIVA
    if (isComprovante(kind) && !mime.startsWith("image/")) {
      return NextResponse.json(
        { error: "Comprovante deve ser IMAGEM (JPG/JPEG/PNG)." },
        { status: 400 }
      );
    }

    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "Arquivo inválido. Envie apenas imagem." }, { status: 400 });
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

    if (!isStaff) {
      if (!isOwnerAuditor && !isUnassigned) {
        return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
      }
    }

    if (isComprovante(kind) && !isStaff) {
      return NextResponse.json(
        { error: "Apenas interno/gestor podem enviar comprovante." },
        { status: 403 }
      );
    }

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
    const filename = `${kind}-${Date.now()}-${base}.${ext}`;
    const storagePath = `${auditoriaId}/${folderFor(kind)}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: mime,
      upsert: true,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    if (!pub?.publicUrl) {
      return NextResponse.json({ error: "Falha ao obter URL pública." }, { status: 500 });
    }

    // ✅ PROVETAS: salva em auditoria_provetas (1 foto por proveta_X)
    // usa maquina_tag = kind (proveta_1 / proveta_2) pra casar com o que a UI já manda
    if (isProveta) {
      const { data: saved, error: pErr } = await admin
        .from("auditoria_provetas")
        .upsert(
          {
            auditoria_id: auditoriaId,
            maquina_tag: kind,
            foto_url: pub.publicUrl,
          },
          { onConflict: "auditoria_id,maquina_tag" }
        )
        .select("*")
        .single();

      if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, kind, url: pub.publicUrl, proveta: saved });
    }

    // ✅ FOTOS "normais": salva na auditoria (colunas)
    const col = kindToColumn(kind);
    if (!col) return NextResponse.json({ error: "kind não mapeado." }, { status: 400 });

    const patch: any = { [col]: pub.publicUrl };
    if (isComprovante(kind) && fechamentoObs) patch.fechamento_obs = fechamentoObs;

    let updated;
    if (!isStaff && role === "auditor" && isUnassigned) {
      const { data, error } = await admin
        .from("auditorias")
        .update({ ...patch, auditor_id: user.id })
        .eq("id", auditoriaId)
        .is("auditor_id", null)
        .select("*")
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "auditoria_ja_assumida" }, { status: 409 });
      updated = data;
    } else {
      const { data, error } = await admin
        .from("auditorias")
        .update(patch)
        .eq("id", auditoriaId)
        .select("*")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      updated = data;
    }

    return NextResponse.json({ ok: true, kind, url: pub.publicUrl, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
