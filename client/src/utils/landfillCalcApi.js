const API_BASE =
  (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "/backend" : "");

const LANDFILL_CALC_API = `${API_BASE}/api/user/landfill/calc`;

export async function fetchLandfillCalculation({
  rows = [],
  config = {},
  anoInicial,
  anoFinal,
  maxYear,
}) {
  const payload = {
    rows,
    config,
    anoInicial,
    anoFinal,
    maxYear,
  };

  const resp = await fetch(LANDFILL_CALC_API, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Erro HTTP ${resp.status} ao calcular aterro`);
  }

  return resp.json();
}
