export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Role = "auditor" | "interno" | "gestor";

export async function GET() {
  try {
    const supabase = supabaseServer();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const user = auth.user;

    const name =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null;

    // role vem do profiles
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      // não quebra o app por causa disso, mas informa
      return NextResponse.json(
        {
          user: { id: user.id, email: user.email ?? null, name },
          role: null,
          warn: "Falha ao carregar role do profiles",
        },
        { status: 200 }
      );
    }

    const role = (prof?.role ?? null) as Role | null;

    return NextResponse.json({
      user: { id: user.id, email: user.email ?? null, name },
      role,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
