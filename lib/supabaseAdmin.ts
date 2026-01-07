import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Faltou NEXT_PUBLIC_SUPABASE_URL no .env.local");
  if (!serviceKey) throw new Error("Faltou SUPABASE_SERVICE_ROLE_KEY no .env.local");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
