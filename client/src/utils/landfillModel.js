// Modelo do aterro (IPCC 2006). Espelha server/controllers/UserDashboard.cpp:
// qualquer mudança aqui precisa ser replicada no backend, que é a fonte dos
// valores de metano usados nos gráficos.

export const DEFAULT_ANO_INICIAL = 2000;
export const DEFAULT_ANO_FINAL = 2060;

export const DEFAULT_COMPOSICAO = {
  papel: 17.1,
  organica: 44.9,
  plastico: 10.8,
  texteis: 2.6,
  madeira: 4.7,
  metal: 2.9,
  vidro: 3.3,
  borracha: 0.7,
  outros: 13.0,
};

export const DEFAULT_LANDFILL_CONFIG = {
  regiao: "Nordeste",
  geracaoKgAnoHab: 328.3,
  taxaColetaPct: 100,
  kMetano: 0.05,
  gerenciamento: "Gerenciado",
  captacaoBiogasPct: 100,
  vidaInicio: DEFAULT_ANO_INICIAL,
  vidaFim: DEFAULT_ANO_FINAL,
  composicao: DEFAULT_COMPOSICAO,
};

// IPCC 2006, Vol. 5, Tabela 3.1.
export const MCF_OPTIONS = [
  { value: "Gerenciado", mcf: 1.0 },
  { value: "Não gerenciado - profundo (>=5 m)", mcf: 0.8 },
  { value: "Não gerenciado - raso (<5 m)", mcf: 0.4 },
  { value: "Não categorizado", mcf: 0.6 },
];

// Rótulos de versões anteriores, ainda presentes em cenários salvos.
const LEGACY_MCF = {
  Parcial: 0.8,
  "Não gerenciado": 0.4,
  "Nao gerenciado": 0.4,
};

export function resolveMcf(gerenciamento) {
  const found = MCF_OPTIONS.find((o) => o.value === gerenciamento);
  if (found) return found.mcf;
  return LEGACY_MCF[gerenciamento] ?? 1.0;
}

export function computeDoc(c) {
  return (
    (c.papel / 100) * 0.4 +
    (c.organica / 100) * 0.15 +
    (c.plastico / 100) * 0.0 +
    (c.texteis / 100) * 0.24 +
    (c.madeira / 100) * 0.43 +
    (c.borracha / 100) * 0.39 +
    (c.metal / 100 + c.vidro / 100 + c.outros / 100) * 0.01
  );
}

// Lo em t CH4 / t RSU: MCF · DOC · DOCf(0,5) · F(0,5) · 16/12
export function computeLoTonPerTon(composicao, gerenciamento) {
  return resolveMcf(gerenciamento) * computeDoc(composicao) * 0.5 * 0.5 * (16 / 12);
}

function toNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : fallback;
}

// Config enviada ao cálculo do backend; mantém todos os campos que afetam o resultado.
export function normalizeLandfillConfig(config) {
  const d = DEFAULT_LANDFILL_CONFIG;
  const merged = {
    ...d,
    ...(config || {}),
    composicao: { ...d.composicao, ...(config?.composicao || {}) },
  };

  const out = {
    regiao: String(merged.regiao || d.regiao),
    geracaoKgAnoHab: toNumber(merged.geracaoKgAnoHab, d.geracaoKgAnoHab),
    taxaColetaPct: toNumber(merged.taxaColetaPct, d.taxaColetaPct),
    kMetano: toNumber(merged.kMetano, d.kMetano),
    gerenciamento: String(merged.gerenciamento || d.gerenciamento),
    captacaoBiogasPct: toNumber(merged.captacaoBiogasPct, d.captacaoBiogasPct),
    vidaInicio: Math.round(toNumber(merged.vidaInicio, d.vidaInicio)),
    vidaFim: Math.round(toNumber(merged.vidaFim, d.vidaFim)),
    composicao: Object.fromEntries(
      Object.keys(d.composicao).map((k) => [k, toNumber(merged.composicao[k], d.composicao[k])])
    ),
  };

  if (merged.popBase != null) out.popBase = toNumber(merged.popBase, 0);
  if (merged.popCrescimentoAnualPct != null) {
    out.popCrescimentoAnualPct = toNumber(merged.popCrescimentoAnualPct, 0);
  }
  return out;
}
