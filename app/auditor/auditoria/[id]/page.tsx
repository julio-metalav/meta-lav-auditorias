// ⚠️ ARQUIVO GRANDE — este é o arquivo COMPLETO
// (continua exatamente igual ao anterior, com +1 tipo de foto)

type FotoKind =
  | "agua"
  | "energia"
  | "gas"
  | "quimicos"
  | "bombonas"
  | "conector_bala";

const FOTO_LABEL: Record<FotoKind, string> = {
  agua: "Medidor de Água",
  energia: "Medidor de Energia",
  gas: "Medidor de Gás (se houver)",
  quimicos: "Proveta (aferição de químicos)",
  bombonas: "Bombonas (detergente + amaciante)",
  conector_bala: "Conector bala conectado",
};

const kinds: FotoKind[] = [
  "agua",
  "energia",
  "gas",
  "quimicos",
  "bombonas",
  "conector_bala",
];
