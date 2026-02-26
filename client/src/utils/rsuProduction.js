const REGION_COEFFS = {
  Norte: { a: -7753.0, b: 4.0 },
  Nordeste: { a: -4588.33, b: 2.44 },
  "Centro-Oeste": { a: 1258.333, b: -0.444 },
  Sudeste: { a: -10093.667, b: 5.222 },
  Sul: { a: -3985.333, b: 2.111 },
};

export function getPerCapKgByRegionYear(regiao, ano, fallbackKgAnoHab = 0) {
  const coeff = REGION_COEFFS[regiao];
  if (!coeff) return Number(fallbackKgAnoHab) || 0;
  return coeff.a + coeff.b * ano;
}

export function calcRsuTonAno({ regiao, coletaPct, ano, populacao, fallbackKgAnoHab = 0 }) {
  const perCapKgAnoHab = getPerCapKgByRegionYear(regiao, ano, fallbackKgAnoHab);
  const coleta = (Number(coletaPct) || 0) / 100;
  const pop = Number(populacao) || 0;
  const rtuKgAno = coleta * perCapKgAnoHab * pop;
  return rtuKgAno / 1000;
}

