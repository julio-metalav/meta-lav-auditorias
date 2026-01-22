import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  if (pathname === "/login") return true;

  // APIs que precisam ser acessíveis
  if (pathname.startsWith("/api/cron/gerar-auditorias-mensais")) return true;
  if (pathname.startsWith("/api/auth/set-session")) return true;

  // Next assets e arquivos estáticos
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;

  // imagens e arquivos comuns
  if (
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return true;
  }

  return false;
}

function hasSupabaseCookie(req: NextRequest) {
  // Suporte aos nomes mais comuns
  const a = req.cookies.get("sb-access-token")?.value;
  const r = req.cookies.get("sb-refresh-token")?.value;
  if (a && r) return true;

  // fallback: se no futuro o cookie vier com outro nome "sb-..."
  const anySb = req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.value);
  return anySb;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 🔒 Se não tem sessão (cookie), manda pro login
  if (!hasSupabaseCookie(req)) {
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
