import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

const BUCKET = "auditorias";

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos" // legado: 1 foto
  | "proveta"  // novo: 1 foto por lavadora (salva em auditoria_provetas)
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

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
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

function toIntOrNull(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toTextOrNull(v: any, max = 80): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = s.slice(0, max);
  return t || null;
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

    // novos campos p/ proveta
    const maquinaIdx = toIntOrNull(form.get("maquina_idx"));
    const maquinaTag = toTextOrNull(form.get("maquina_tag"));

    if (!kind) return NextResponse.json({ error: "kind é obrigatório." }, { status: 400 });
    if (!file) return NextResponse.json({ error: "file é obrigatório." }, { status: 400 });

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

    // 🔒 REGRA DEFINITIVA
    if (isComprovante(kind) && !mime.startsWith("image/")) {
      return NextResponse.json({ error: "Comprovante deve ser IMAGEM (JPG/JPEG/PNG)." }, { status: 400 });
    }
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "Arquivo inválido. Envie apenas imagem." }, { status: 400 });
    }

    // proveta exige maquina_idx (1..N). maquina_tag é opcional (default lavadora)
    if (isProveta(kind)) {
      if (!maquinaIdx || maquinaIdx < 1) {
        return NextResponse.json({ error: "Para kind=proveta, envie maquina_idx (>= 1)." }, { status: 400 });
      }
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
      return NextResponse.json({ error: "Apenas interno/gestor podem enviar comprovante." }, { status: 403 });
    }

    // auditor (não staff) não altera fotos após conferência/final (vale p/ proveta também)
    if (
      role === "auditor" &&
      !isStaff &&
      !isComprovante(kind) &&
      (statusAtual === "em_conferencia" || statusAtual === "final")
    ) {
      return NextResponse.json({ error: "Auditor não pode alterar fotos após conferência/final." }, { status: 403 });
    }

    // ✅ se auditor e auditoria sem auditor_id, tenta assumir (para qualquer kind != comprovante)
    if (!isStaff && role === "auditor" && isUnassigned && !isComprovante(kind)) {
      const { data: claimed, error: claimErr } = await admin
        .from("auditorias")
        .update({ auditor_id: user.id })
        .eq("id", auditoriaId)
        .is("auditor_id", null)
        .select("id,auditor_id")
        .maybeSingle();

      if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
      if (!claimed) return NextResponse.json({ error: "auditoria_ja_assumida" }, { status: 409 });
    }

    // upload no storage
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);

    // nome do arquivo: proveta-idx1... etc
    const stamp = Date.now();
    const filename = isProveta(kind)
      ? `${kind}-idx${maquinaIdx}-${stamp}-${base}.${ext}`
      : `${kind}-${stamp}-${base}.${ext}`;

    const path = `${auditoriaId}/${folderFor(kind)}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    if (!pub?.publicUrl) {
      return NextResponse.json({ error: "Falha ao obter URL pública." }, { status: 500 });
    }

    // ======= CASO NOVO: PROVETA (salva na tabela auditoria_provetas) =======
    if (isProveta(kind)) {
      const tag = maquinaTag ?? "lavadora";

      // upsert pela unique (auditoria_id, maquina_tag, maquina_idx)
      const { data: row, error: pErr } = await admin
        .from("auditoria_provetas")
        .upsert(
          {
            auditoria_id: auditoriaId,
            maquina_tag: tag,
            maquina_idx: maquinaIdx,
            foto_url: pub.publicUrl,
          },
          { onConflict: "auditoria_id,maquina_tag,maquina_idx" }
        )
        .select("id,auditoria_id,maquina_tag,maquina_idx,foto_url,created_at")
        .maybeSingle();

      if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

      return NextResponse.json({
        ok: true,
        kind,
        url: pub.publicUrl,
        proveta: row ?? {
          auditoria_id: auditoriaId,
          maquina_tag: tag,
          maquina_idx: maquinaIdx,
          foto_url: pub.publicUrl,
        },
      });
    }

    // ======= CASO LEGADO: fotos na tabela auditorias =======
    const col = kindToColumn(kind);
    if (!col) return NextResponse.json({ error: "kind não mapeado." }, { status: 400 });

    const patch: any = { [col]: pub.publicUrl };
    if (isComprovante(kind) && fechamentoObs) patch.fechamento_obs = fechamentoObs;

    const { data: updated, error: uErr } = await admin
      .from("auditorias")
      .update(patch)
      .eq("id", auditoriaId)
      .select("*")
      .single();

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, kind, url: pub.publicUrl, auditoria: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
