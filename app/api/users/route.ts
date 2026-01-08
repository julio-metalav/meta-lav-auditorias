export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function getLoggedUser() {
  const supabase = createRouteHandlerClient({ cookies });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user; // { id, email, ... }
}

async function isGestor(userId: string) {
  const admin = supabaseAdmin();

  // busca role via service role (não depende de RLS)
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) return false;
  return data?.role === "gestor";
}

// GET /api/users -> lista profiles
export async function GET() {
  const user = await
