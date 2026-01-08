export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole, roleGte } from "@/lib/auth";

export async function GET() {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let q = supabase
    .from("auditorias")
    .select(
      "id,condominio_id,mes_ref,status,auditor_id,created_at,condominios(nome,cidade,uf)"
    )
    .order("mes_ref", { ascending: false });

  if (role === "auditor") {
    q = q.eq("auditor_id", user.id);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const { supabase, user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!roleGte(role, "interno")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const condominio_id = String(body?.condominio_id || "").trim();
  const mes_ref = String(body?.mes_ref || "").trim();
  const auditor_id = String(body?.auditor_id || "").trim();
  const status = String(body?.status || "aberta").trim();

  if (!condominio_id || !mes_ref || !auditor_id) {
    return NextResponse.json(
      { error: "Campos obrigatórios: condominio_id, mes_ref (ex: 2026-01-01), auditor_id" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("auditorias")
    .insert({
      condominio_id,
      mes_ref,
      status,
      auditor_id,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}
