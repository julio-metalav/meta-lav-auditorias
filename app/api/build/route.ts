export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? null,
      at: new Date().toISOString(),
    },
    { status: 200 }
  );
}
