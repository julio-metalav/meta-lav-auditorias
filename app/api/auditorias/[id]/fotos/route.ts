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
  if (isComprovante(kind)) return "fechamento";
  return "fotos";
}

function extFromFileName(name: string) {
  const n = name.toLowerCase();
  const parts = n.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "bin";
  if (!ext) return "bin";
  return ext.replace(/[^a-z0-9]/g, "") || "bin";
}

function safeFileBase(name: string) {
  const base = name
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "file";
}

function looksLikePdfByExt(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

async function getRole(supabase: ReturnType<typeof supabaseServer>): Promise<Role | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return (prof?.role ?? null) as Role | null;
}

function kindToColumn(kind: string) {
  if (kind === "agua") return "foto_agua_url";
  if (kind === "energia") return "foto_energia_url";
  if (kind === "gas") return "foto_gas_url";
  if (kind === "quimicos") return "foto_quimicos_url";
  if (kind === "bombonas") return "foto_bombonas_url";
  if (kind === "conector_bala") return "foto_conector_bala_url";
  if (kind === "comprovante_fechamento") return "comprovante_fechamento_url";
  return null;
}

function toShortText(v: any, max = 800) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auditoriaId = params.id;

    // 1) sessão do usuário
    const supabase = supabaseServer();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user;
    if (authErr || !user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    // 2) role
    const role = await getRole(supabase);
    if (!role) return NextResponse.json({ error: "Sem role." }, { status: 403 });

    // 3) Admin client (service role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase env não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4) form-data
    const form = await req.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file") as File | null;
const mime = (file as any)?.type ? String((file as any).type) : "";

if (kind === "comprovante_fechamento" && !mime.startsWith("image/")) {
  return bad("Comprovante deve ser IMAGEM (JPG/JPEG). PDF não é suportado no relatório.", 400);
}


    // opcional (somente para comprovante)
    const fechamentoObs = toShortText(form.get("fechamento_obs"));

    if (!kind) return NextResponse.json({ error: "kind é obrigatório." }, { status: 400 });
    if (!file) return NextResponse.json({ error: "file é obrigatório." }, { status: 400 });

    const okKinds: FotoKind[] = [
      "agua",
      "energia",
      "gas",
      "quimicos",
      "bombonas",
      "conector_bala",
      "comprovante_fechamento",
    ];
    if (!okKinds.includes(kind as FotoKind)) {
      return NextResponse.json({ error: "kind inválido." }, { status: 400 });
    }

    // aceita imagem ou PDF (para comprovante)
    const isPdf = looksLikePdfByExt(file.name) || file.type === "application/pdf";
    const isImage = (file.type || "").startsWith("image/");
    if (!isPdf && !isImage) {
      return NextResponse.json({ error: "Arquivo inválido. Envie imagem ou PDF." }, { status: 400 });
    }

    // 5) Carrega auditoria (status + auditor_id + condominio_id)
    const { data: aud, error: audErr } = await admin
      .from("auditorias")
      .select("id,condominio_id,auditor_id,status")
      .eq("id", auditoriaId)
      .single();

    if (audErr || !aud) {
      return NextResponse.json({ error: audErr?.message ?? "Auditoria não encontrada." }, { status: 404 });
    }

    const statusAtual = normalizeStatus(aud.status);
    const isStaff = role === "interno" || role === "gestor";
    const isOwnerAuditor = role === "auditor" && aud.auditor_id === user.id;
    const isUnassigned = !aud.auditor_id; // ✅ fila aberta

    // ✅ Permissão base (regra nova):
    // - interno/gestor sempre
    // - auditor: se for dono OU se estiver sem auditor (fila aberta)
    // - se estiver atribuído a outro auditor => proibido
    if (!isStaff) {
      if (role !== "auditor") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
      if (!isOwnerAuditor && !isUnassigned) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    // Regras por tipo:
    // - comprovante_fechamento: somente interno/gestor
    // - fotos: auditor não altera após em_conferencia/final
    if (isComprovante(kind)) {
      if (!isStaff) {
        return NextResponse.json(
          { error: "Apenas interno/gestor podem enviar comprovante de fechamento." },
          { status: 403 }
        );
      }
    } else {
      if (role === "auditor" && !isStaff && (statusAtual === "em_conferencia" || statusAtual === "final")) {
        return NextResponse.json(
          { error: "Auditor não pode alterar fotos após em_conferencia/final." },
          { status: 403 }
        );
      }
    }

    // 6) Upload no Storage
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromFileName(file.name);
    const base = safeFileBase(file.name);
    const filename = `${kind}-${Date.now()}-${base}.${ext}`;
    const path = `${auditoriaId}/${folderFor(kind)}/${filename}`;

    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || (looksLikePdfByExt(file.name) ? "application/pdf" : "application/octet-stream"),
      upsert: true,
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl ?? null;
    if (!publicUrl) return NextResponse.json({ error: "Falha ao obter public URL." }, { status: 500 });

    // 7) Atualiza coluna na auditoria (com claim atômico quando fila aberta)
    const col = kindToColumn(kind);
    if (!col) return NextResponse.json({ error: "kind não mapeado para coluna." }, { status: 400 });

    const patch: any = { [col]: publicUrl };

    if (isComprovante(kind) && fechamentoObs) {
      patch.fechamento_obs = fechamentoObs;
    }

    // ✅ CLAIM ATÔMICO NO PRIMEIRO ATO (UPLOAD):
    // se auditor e auditoria está sem auditor_id, assume junto com o update,
    // com condição auditor_id IS NULL para evitar corrida entre auditores.
    let updatedRow: any = null;

    if (!isStaff && role === "auditor" && isUnassigned) {
      const { data, error: updErr } = await admin
        .from("auditorias")
        .update({ ...patch, auditor_id: user.id })
        .eq("id", auditoriaId)
        .is("auditor_id", null)
        .select("*")
        .maybeSingle();

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      if (!data) {
        // alguém assumiu antes
        return NextResponse.json({ error: "auditoria_ja_assumida" }, { status: 409 });
      }

      updatedRow = data;
    } else {
      const { data, error: updErr } = await admin
        .from("auditorias")
        .update(patch)
        .eq("id", auditoriaId)
        .select("*")
        .single();

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      updatedRow = data;
    }

    return NextResponse.json({
      ok: true,
      kind,
      url: publicUrl,
      auditoria: updatedRow,
      updated: updatedRow,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
