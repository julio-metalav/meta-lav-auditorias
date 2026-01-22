import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const access_token = String(body?.access_token ?? "").trim();
    const refresh_token = String(body?.refresh_token ?? "").trim();

    if (!access_token || !refresh_token) {
      return bad("Tokens ausentes (access_token/refresh_token).", 400);
    }

    const res = NextResponse.json({ ok: true });

    // Cookies padrão (httpOnly) pro server/middleware conseguirem ler
    // Obs: em HTTPS (Vercel) usamos secure=true
    res.cookies.set("sb-access-token", access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    res.cookies.set("sb-refresh-token", refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    return res;
  } catch (e: any) {
    return bad("Falha ao setar sessão.", 500, { details: e?.message ?? String(e) });
  }
}
