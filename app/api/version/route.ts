export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? null,
    cron_secret_is_set: !!String(process.env.CRON_SECRET ?? "").trim(),
    emergency_pin_is_set: !!String(process.env.EMERGENCY_PIN ?? "").trim(),
  });
}
