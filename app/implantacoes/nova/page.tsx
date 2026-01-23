"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NovaImplantacaoPage() {
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [dataContrato, setDataContrato] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setErro(null);

    if (!nome || !dataContrato) {
      setErro("Nome do condomínio e data do contrato são obrigatórios");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/implantacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_condominio: nome,
          endereco,
          data_contrato: dataContrato,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setErro(json?.error ?? "Erro ao criar implantação");
        return;
      }

      // redireciona para a tela da implantação criada
      router.push(`/implantacoes/${json.id}`);
    } catch (e: any) {
      setErro(e?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>
        Nova Implantação
      </h1>

      {erro && (
        <div style={{ marginBottom: 12, color: "#c00" }}>
          {erro}
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12 }}>Condomínio</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            style={{ width: "100%", padding: 12 }}
            placeholder="Ex: Residencial Alpha"
          />
        </div>

        <div>
          <label style={{ fontSize: 12 }}>Endereço (opcional)</label>
          <input
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            style={{ width: "100%", padding: 12 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12 }}>Data do contrato</label>
          <input
            type="date"
            value={dataContrato}
            onChange={(e) => setDataContrato(e.target.value)}
            style={{ width: "100%", padding: 12 }}
          />
        </div>

        <button
          onClick={criar}
          disabled={loading}
          style={{
            marginTop: 10,
            padding: "14px",
            fontWeight: 700,
            background: "#16a34a",
            color: "white",
            border: "none",
            cursor: "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Criando..." : "Criar Implantação"}
        </button>
      </div>
    </div>
  );
}
