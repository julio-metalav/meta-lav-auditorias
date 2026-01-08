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
