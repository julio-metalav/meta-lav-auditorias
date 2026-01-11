export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    null;

  const ref =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.GIT_BRANCH ||
    process.env.BRANCH ||
    null;

  const env =
    process.env.VERCEL_ENV || process.env.NODE_ENV || null;

  const now = new Date().toISOString();

  return NextResponse.json(
    {
      ok: true,
      sha,
      ref,
      env,
      at: now,
    },
    { status: 200 }
  );
}
