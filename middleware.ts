import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// middleware é SEMPRE Edge -> NÃO pode importar supabase-js aqui.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // libera arquivos, login e rotas públicas
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // Só checa se tem cookie de sessão do Supabase (sem validar)
  const hasSbCookie =
    req.cookies.get("sb-access-token") ||
    req.cookies.get("sb-refresh-token") ||
    // alguns setups guardam o token com prefixo do projeto:
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
