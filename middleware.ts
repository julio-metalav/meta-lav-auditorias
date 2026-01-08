import { NextResponse, type NextRequest } from "next/server";

// Middleware "no-op" (não faz auth aqui).
// Motivo: middleware roda em Edge e não pode puxar libs que usam Node APIs.
// A autenticação/role já está sendo tratada pelo app via /api/me e nas rotas /api.
const PUBLIC_FILE = /\.(.*)$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // libera assets e páginas públicas
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/login") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Deixa passar. As páginas já validam sessão via /api/me.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
