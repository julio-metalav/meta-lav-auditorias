"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";

type Role = "auditor" | "interno" | "gestor";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function AuditoriaRedirectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  const [msg, setMsg] = useState("Carregando…");

  useEffect(() => {
    async function go() {
      if (!isUuid(id)) {
        setMsg("ID inválido.");
        return;
      }

      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error
