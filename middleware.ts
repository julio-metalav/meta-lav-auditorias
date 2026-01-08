import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_FILE = /\.(.*)$/;

// middleware é SEMPRE Edge -> NÃO pode importar supabase-js aqui.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // libera arquivos, assets e páginas públicas
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Só checa se tem cookie de sessão do Supabase (sem validar)
  const hasSbCookie =
    req.cookies.get("sb-access-token") ||
    req.cookies.get("sb-refresh-token") ||
    Array.from(req.cookies.getAll()).some((c) => c.name.startsWith("sb-"));

  if (!hasSbCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
