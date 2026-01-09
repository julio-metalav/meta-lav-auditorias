import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const user = auth.user;

    // tenta pegar um "nome" do metadata (se existir)
    const name =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null;

    return NextResponse.json({
      id: user.id,
      email: user.email ?? null,
      name,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro inesperado" }, { status: 500 });
  }
}
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getUserAndRole } from "@/lib/auth";

export async function GET() {
  const { user, role } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({
    user: { id: user.id, email: user.email },
    role,
  });
}
