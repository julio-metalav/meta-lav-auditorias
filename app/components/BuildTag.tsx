"use client";

import { useMemo } from "react";

export function BuildTag() {
  // opcional: você pode setar NEXT_PUBLIC_BUILD_TAG no Vercel depois
  const tag = useMemo(() => {
    const t = (process.env.NEXT_PUBLIC_BUILD_TAG ?? "").trim();
    return t || null;
  }, []);

  if (!tag) return null;

  return (
    <div className="mt-6">
      <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
        <span className="font-mono">build</span>
        <span className="font-semibold">{tag}</span>
      </div>
    </div>
  );
}
