import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // =========================================================
  // ✅ LIBERA CRON (NUNCA PASSA POR AUTH / REDIRECT)
  // =========================================================
  if (pathname.startsWith("/api/cron/gerar-auditorias-mensais")) {
    return NextResponse.next();
  }

  // =========================================================
  // ⚙️ A PARTIR DAQUI É O SEU FLUXO NORMAL (INALTERADO)
  // =========================================================

  // ignora assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  // páginas públicas (ajuste se tiver mais)
  if (
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  // 🔒 proteção padrão (exemplo típico)
  // aqui entra sua lógica existente de auth:
  // cookies, headers, supabase, etc.
  // ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓

  // se chegou até aqui, redireciona para login
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron/gerar-auditorias-mensais).*)",
  ],
};
