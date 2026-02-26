import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/Rsu.css";
import { ResponsiveLine } from "@nivo/line";
import { useDashboard } from "../context/DashboardContext.jsx";
import { calcRsuTonAno } from "../utils/rsuProduction.js";

const API_BASE =
  (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "/backend" : "");
const DASHBOARD_API = `${API_BASE}/api/user/dashboard`;

function clampNum(v, min, max) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parsePct(v) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function rangeYears(from, to) {
  const out = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

function makeDefaultDraft() {
  return {
    // Captação RSU
    taxaColetaPct: null,
    regiao: "Nordeste",
    geracaoKgAnoHab: null,
    vidaInicio: 2015,
    vidaFim: 2035,

    // Produção
    captacaoBiogasPct: 100,
    tempAnaerobicaC: null,
    gerenciamento: "Gerenciado",
    kMetano: 0.05,

    // Composição
    composicao: {
      papel: 17.1,
      plastico: 10.8,
      madeira: 4.7,
      vidro: 3.3,
      outros: 13.0,
      organica: 44.9,
      texteis: 2.6,
      metal: 2.9,
      borracha: 0.7,
    },

    // Série
    popBase: 499990,
    popCrescimentoAnualPct: 0.95,
  };
}

function normalizeConfig(config) {
  const base = makeDefaultDraft();
  if (!config || typeof config !== "object") return base;
  return {
    ...base,
    ...config,
    composicao: {
      ...base.composicao,
      ...(config.composicao || {}),
    },
  };
}

function isDefaultConfig(config) {
  if (!config || typeof config !== "object") return true;
  const base = makeDefaultDraft();
  return (
    String(config.regiao) === base.regiao &&
    Number(config.geracaoKgAnoHab) === base.geracaoKgAnoHab &&
    Number(config.taxaColetaPct) === base.taxaColetaPct &&
    Number(config.vidaInicio) === base.vidaInicio &&
    Number(config.vidaFim) === base.vidaFim &&
    Number(config.captacaoBiogasPct) === base.captacaoBiogasPct &&
    Number(config.tempAnaerobicaC) === base.tempAnaerobicaC &&
    Number(config.kMetano) === base.kMetano &&
    String(config.gerenciamento) === base.gerenciamento &&
    Number(config.popBase) === base.popBase &&
    Number(config.popCrescimentoAnualPct) === base.popCrescimentoAnualPct
  );
}

function fmtInt(n) {
  try {
    return new Intl.NumberFormat("pt-BR").format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
}

function fmt1(n) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
}

function fmt4(n) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 4,
      minimumFractionDigits: 4,
    }).format(n);
  } catch {
    return String(n);
  }
}

export default function Rsu() {
  const [loaded, setLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const {
    loadingUser,
    scenarios,
    currentScenarioId,
    rsuByScenario,
    setRsuByScenario,
  } = useDashboard();

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const YEARS = useMemo(() => rangeYears(2000, 2060), []);
  const REGIOES = useMemo(
    () => [
      { id: "Norte", kgAnoHab: 320 },
      { id: "Nordeste", kgAnoHab: 328.3 },
      { id: "Centro-Oeste", kgAnoHab: 360 },
      { id: "Sudeste", kgAnoHab: 380 },
      { id: "Sul", kgAnoHab: 370 },
    ],
    []
  );

  const [draft, setDraft] = useState(() => makeDefaultDraft());
  const [model, setModel] = useState(() => makeDefaultDraft());
  const hydratedScenariosRef = useRef(new Set());
  const readyToPersistRef = useRef(new Set());
  const refreshAttemptedRef = useRef(new Set());
  const prevRegiaoRef = useRef(makeDefaultDraft().regiao);

  const scenarioTotals = useMemo(() => {
    const scenario = scenarios.find(
      (s) => String(s.id) === String(currentScenarioId)
    );
    if (!scenario?.rows?.length) return null;
    const totals = {};
    for (const row of scenario.rows) {
      const series = row.series || {};
      for (const [yearKey, value] of Object.entries(series)) {
        const year = Number(yearKey);
        if (!Number.isFinite(year)) continue;
        const pop = Number(value) || 0;
        totals[year] = (totals[year] || 0) + pop;
      }
    }
    return Object.keys(totals).length ? totals : null;
  }, [scenarios, currentScenarioId]);

  useEffect(() => {
    if (!currentScenarioId) return;
    if (loadingUser) return;
    const hydrated = hydratedScenariosRef.current;

    const entry = rsuByScenario?.[currentScenarioId];
    if (entry?.config) {
      if (hydrated.has(currentScenarioId) && !isDefaultConfig(draft)) {
        return;
      }
      const normalized = normalizeConfig(entry.config);
      setDraft(normalized);
      setModel(normalized);
      hydrated.add(currentScenarioId);
      readyToPersistRef.current.add(currentScenarioId);
      return;
    }

    const nextDefault = makeDefaultDraft();
    setDraft(nextDefault);
    setModel(nextDefault);
    hydrated.add(currentScenarioId);
    readyToPersistRef.current.add(currentScenarioId);
  }, [currentScenarioId, rsuByScenario, loadingUser]);

  useEffect(() => {
    if (loadingUser) return;
    if (!currentScenarioId) return;
    const entry = rsuByScenario?.[currentScenarioId];
    if (entry?.config && !isDefaultConfig(entry.config)) return;

    const attempted = refreshAttemptedRef.current;
    if (attempted.has(currentScenarioId)) return;
    attempted.add(currentScenarioId);

    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(DASHBOARD_API, {
          method: "GET",
          credentials: "include",
        });
        if (!resp.ok) return;
        const json = await resp.json();
        if (cancelled) return;

        const serverRsuByScenario =
          json && typeof json.rsuByScenario === "object" && json.rsuByScenario
            ? json.rsuByScenario
            : {};
        if (!Object.keys(serverRsuByScenario).length) return;

        setRsuByScenario(serverRsuByScenario);

        const serverEntry = serverRsuByScenario[currentScenarioId];
        if (serverEntry?.config) {
          const normalized = normalizeConfig(serverEntry.config);
          setDraft(normalized);
          setModel(normalized);
          hydratedScenariosRef.current.add(currentScenarioId);
          readyToPersistRef.current.add(currentScenarioId);
        }
      } catch {
        // best-effort refresh
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadingUser, currentScenarioId, rsuByScenario, setRsuByScenario]);

  useEffect(() => {
    if (!scenarioTotals) return;
    const defaults = makeDefaultDraft();
    const vidaInicio = Number(draft.vidaInicio);
    const vidaFim = Number(draft.vidaFim);
    const popInicio = scenarioTotals[vidaInicio];
    const popFim = scenarioTotals[vidaFim];
    if (!Number.isFinite(popInicio) || !Number.isFinite(popFim) || popInicio <= 0) return;

    const years = Math.max(1, vidaFim - vidaInicio);
    const growth = Math.pow(popFim / popInicio, 1 / years) - 1;
    const popBase = Math.round(popInicio);
    const popCrescimentoAnualPct = round1(growth * 100);

    const canAutoSync =
      draft.popBase === defaults.popBase &&
      round1(draft.popCrescimentoAnualPct) === round1(defaults.popCrescimentoAnualPct);

    if (!canAutoSync) return;

    setDraft((prev) => {
      if (
        prev.popBase === popBase &&
        round1(prev.popCrescimentoAnualPct) === popCrescimentoAnualPct
      ) {
        return prev;
      }
      return { ...prev, popBase, popCrescimentoAnualPct };
    });

    setModel((prev) => {
      if (
        prev.popBase === popBase &&
        round1(prev.popCrescimentoAnualPct) === popCrescimentoAnualPct
      ) {
        return prev;
      }
      return { ...prev, popBase, popCrescimentoAnualPct };
    });
  }, [scenarioTotals, draft.vidaInicio, draft.vidaFim, draft.popBase, draft.popCrescimentoAnualPct]);

  // Auto-sugestão do Kg/Ano/Hab ao mudar região (mantém editável pelo input)
  useEffect(() => {
    const found = REGIOES.find((r) => r.id === draft.regiao);
    if (!found) return;
    const prevRegiao = prevRegiaoRef.current;
    const prevFound = REGIOES.find((r) => r.id === prevRegiao);
    const prevDefault = prevFound?.kgAnoHab;
    const shouldUpdate =
      typeof prevDefault === "number" &&
      Number(draft.geracaoKgAnoHab) === Number(prevDefault);

    prevRegiaoRef.current = draft.regiao;
    if (!shouldUpdate) return;
    setDraft((d) => ({ ...d, geracaoKgAnoHab: found.kgAnoHab }));
  }, [draft.regiao, draft.geracaoKgAnoHab, REGIOES]);

  // Composição como números (robusto contra string/vazio/virgula)
  const compNums = useMemo(() => {
    const c = draft.composicao;
    return {
      papel: parsePct(c.papel),
      plastico: parsePct(c.plastico),
      madeira: parsePct(c.madeira),
      vidro: parsePct(c.vidro),
      outros: parsePct(c.outros),
      organica: parsePct(c.organica),
      texteis: parsePct(c.texteis),
      metal: parsePct(c.metal),
      borracha: parsePct(c.borracha),
    };
  }, [draft.composicao]);

  const somaComposicao = useMemo(() => {
    const sum = Object.values(compNums).reduce((acc, x) => acc + x, 0);
    return round1(sum);
  }, [compNums]);

  const deltaComposicao = useMemo(() => round1(100 - somaComposicao), [somaComposicao]);
  const compOk = useMemo(() => Math.abs(deltaComposicao) <= 0.2, [deltaComposicao]);

  const loCalculado = useMemo(() => {
    const gerenciamento = String(draft.gerenciamento || "");
    const mcf =
      gerenciamento === "Parcial"
        ? 0.8
        : gerenciamento === "Não gerenciado" || gerenciamento === "Nao gerenciado"
          ? 0.4
          : 1.0;

    const doc =
      (compNums.papel / 100) * 0.4 +
      (compNums.organica / 100) * 0.15 +
      (compNums.plastico / 100) * 0.0 +
      (compNums.texteis / 100) * 0.24 +
      (compNums.madeira / 100) * 0.43 +
      (compNums.borracha / 100) * 0.39 +
      ((compNums.metal / 100) + (compNums.vidro / 100) + (compNums.outros / 100)) * 0.01;

    return mcf * doc * 0.5 * 0.5 * (16 / 12);
  }, [draft.gerenciamento, compNums]);

  const normalizarComposicao = () => {
    const keys = Object.keys(compNums);
    const sum = Object.values(compNums).reduce((a, b) => a + b, 0);
    if (sum <= 0) return;

    const factor = 100 / sum;
    const normalized = {};
    for (const k of keys) normalized[k] = round1(compNums[k] * factor);

    // Ajuste fino para fechar 100% após arredondamento
    const sum2 = Object.values(normalized).reduce((a, b) => a + b, 0);
    const diff = round1(100 - sum2);
    if (diff !== 0) {
      let maxK = keys[0];
      for (const k of keys) if (normalized[k] > normalized[maxK]) maxK = k;
      normalized[maxK] = round1(normalized[maxK] + diff);
    }

    setDraft((d) => ({ ...d, composicao: { ...d.composicao, ...normalized } }));
  };

  const onAtualizar = () => {
    const vidaInicio = clampNum(draft.vidaInicio, 1900, 2100);
    const vidaFim = clampNum(draft.vidaFim, vidaInicio, 2100);

    const sanitized = {
      ...draft,
      taxaColetaPct: clampNum(draft.taxaColetaPct, 0, 100),
      geracaoKgAnoHab: clampNum(draft.geracaoKgAnoHab, 0, 2000),
      vidaInicio,
      vidaFim,
      captacaoBiogasPct: clampNum(draft.captacaoBiogasPct, 0, 100),
      tempAnaerobicaC: clampNum(draft.tempAnaerobicaC, -50, 500),
      kMetano: clampNum(draft.kMetano, 0, 10),
      popBase: clampNum(draft.popBase, 0, 1e9),
      popCrescimentoAnualPct: clampNum(draft.popCrescimentoAnualPct, -10, 20),
      composicao: Object.fromEntries(
        Object.entries(draft.composicao).map(([k, v]) => [k, clampNum(parsePct(v), 0, 100)])
      ),
    };

    setModel(sanitized);
  };

  const series = useMemo(() => {
    const years = rangeYears(model.vidaInicio, model.vidaFim);
    const growth = model.popCrescimentoAnualPct / 100;

    const rows = years.map((ano, i) => {
      const popFromScenario = scenarioTotals?.[ano];
      const pop = Number.isFinite(popFromScenario)
        ? popFromScenario
        : model.popBase * Math.pow(1 + growth, i);
      const rsuTAno = calcRsuTonAno({
        regiao: model.regiao,
        coletaPct: model.taxaColetaPct,
        ano,
        populacao: pop,
        fallbackKgAnoHab: model.geracaoKgAnoHab,
      });
      return { ano, pop, rsuTAno };
    });

    const nivo = [
      {
        id: "Produção de RSU (T/ano)",
        data: rows.map((r) => ({ x: String(r.ano), y: Number(r.rsuTAno.toFixed(1)) })),
      },
    ];

    return { rows, nivo };
  }, [model, scenarioTotals]);

  useEffect(() => {
    if (!currentScenarioId) return;
    if (!readyToPersistRef.current.has(currentScenarioId)) return;
    setRsuByScenario((prev) => {
      const safePrev = prev || {};
      const prevEntry = safePrev[currentScenarioId];
      const nextEntry = {
        config: model,
        series: series.rows,
      };

      if (
        prevEntry &&
        JSON.stringify(prevEntry.config) === JSON.stringify(nextEntry.config) &&
        JSON.stringify(prevEntry.series) === JSON.stringify(nextEntry.series)
      ) {
        return safePrev;
      }

      return {
        ...safePrev,
        [currentScenarioId]: nextEntry,
      };
    });
  }, [currentScenarioId, model, series.rows, setRsuByScenario]);

  if (loadingUser) {
    return (
      <div className={`home-container ${loaded ? "fade-in" : ""}`}>
        <p>Carregando dados do usuário…</p>
      </div>
    );
  }

  return (
    <div className={`home-container ${loaded ? "fade-in" : ""}`}>
     <header className="home-header">
        <div>
          <h1>Resíduos Sólidos Urbanos (RSU)</h1>
          <p>Configure captação e produção para projetar os indicadores anuais do cenário.</p>
        </div>
      </header>

      <main className="home-grid rsu-grid">
        {/* Card combinado: Captação + Produção */}
        <section className="card glow rsu-config-card">
          <div className="rsu-config-header">
            <h3 className="rsu-section-title">Captação de RSU</h3>
            <h3 className="rsu-section-title">Característica de Produção</h3>
          </div>

          <div className="rsu-config-grid">
            <div className="rsu-config-col">
              <div className="rsu-form">
                <div className="field">
                  <label>Taxa de Coleta (%)</label>
                  <input
                    type="number"
                    value={draft.taxaColetaPct}
                    onChange={(e) => setDraft((d) => ({ ...d, taxaColetaPct: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>Região (geração RSU padrão)</label>
                  <select value={draft.regiao} onChange={(e) => setDraft((d) => ({ ...d, regiao: e.target.value }))}>
                    {REGIOES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Tempo de Vida Útil do aterro</label>
                  <div className="field-inline">
                    <select
                      value={draft.vidaInicio}
                      onChange={(e) => setDraft((d) => ({ ...d, vidaInicio: +e.target.value }))}
                    >
                      {YEARS.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>

                    <select value={draft.vidaFim} onChange={(e) => setDraft((d) => ({ ...d, vidaFim: +e.target.value }))}>
                      {YEARS.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="rsu-config-col">
              <div className="rsu-form two-cols">
                <div className="field">
                  <label>Captação de Biogás (%)</label>
                  <input
                    type="number"
                    value={draft.captacaoBiogasPct}
                    onChange={(e) => setDraft((d) => ({ ...d, captacaoBiogasPct: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>Temperatura na Região anaeróbica (°C)</label>
                  <input
                    type="number"
                    value={draft.tempAnaerobicaC}
                    onChange={(e) => setDraft((d) => ({ ...d, tempAnaerobicaC: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>Geração de Metano (k)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={draft.kMetano}
                    onChange={(e) => setDraft((d) => ({ ...d, kMetano: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>Gerenciamento do Aterro</label>
                  <select
                    value={draft.gerenciamento}
                    onChange={(e) => setDraft((d) => ({ ...d, gerenciamento: e.target.value }))}
                  >
                    <option>Gerenciado</option>
                    <option>Parcial</option>
                    <option>Não gerenciado</option>
                  </select>
                </div>

                <div className="field">
                  <label>População base (hab)</label>
                  <input type="number" value={draft.popBase} onChange={(e) => setDraft((d) => ({ ...d, popBase: e.target.value }))} />
                </div>

                <div className="field">
                  <label>Crescimento anual da população (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={draft.popCrescimentoAnualPct}
                    onChange={(e) => setDraft((d) => ({ ...d, popCrescimentoAnualPct: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tabela (direita, 2 linhas) */}
        <section className="card glow rsu-tableCard">
          <h3 className="rsu-section-title">Produção de RSU (Ano/T/Hab.)</h3>

          <div className="table-wrap" role="region" aria-label="Tabela de produção de RSU">
            <table className="rsu-table">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th>RSU (T/ano)</th>
                  <th>População</th>
                </tr>
              </thead>
              <tbody>
                {series.rows.map((r) => (
                  <tr key={r.ano}>
                    <td>{r.ano}</td>
                    <td>{fmt1(r.rsuTAno)}</td>
                    <td>{fmtInt(r.pop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Composição */}
        <section className="card glow rsu-comp">
          <h3 className="rsu-section-title">Características do RSU</h3>

          <div className="rsu-comp-grid">
            <div className="field">
              <label>Papel e Papelão (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.papel}
                onChange={(e) => setDraft((d) => ({ ...d, composicao: { ...d.composicao, papel: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label>Plástico (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.plastico}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, composicao: { ...d.composicao, plastico: e.target.value } }))
                }
              />
            </div>

            <div className="field">
              <label>Madeira (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.madeira}
                onChange={(e) => setDraft((d) => ({ ...d, composicao: { ...d.composicao, madeira: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label>Vidro (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.vidro}
                onChange={(e) => setDraft((d) => ({ ...d, composicao: { ...d.composicao, vidro: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label>Outros (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.outros}
                onChange={(e) => setDraft((d) => ({ ...d, composicao: { ...d.composicao, outros: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label>Matéria Orgânica (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.organica}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, composicao: { ...d.composicao, organica: e.target.value } }))
                }
              />
            </div>

            <div className="field">
              <label>Têxteis (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.texteis}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, composicao: { ...d.composicao, texteis: e.target.value } }))
                }
              />
            </div>

            <div className="field">
              <label>Metal (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.metal}
                onChange={(e) => setDraft((d) => ({ ...d, composicao: { ...d.composicao, metal: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label>Borracha/couro (%)</label>
              <input
                type="number"
                step="0.1"
                value={draft.composicao.borracha}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, composicao: { ...d.composicao, borracha: e.target.value } }))
                }
              />
            </div>

            <div className="rsu-comp-actions">
              <button className="btn-primary glow" type="button" onClick={onAtualizar}>
                ATUALIZAR
              </button>

              <button className="btn-secondary" type="button" onClick={normalizarComposicao}>
                Normalizar p/ 100%
              </button>

              <div className={`rsu-sum ${compOk ? "ok" : "warn"}`}>
                Soma: <b>{fmt1(somaComposicao)}</b>%{" "}
                {compOk ? (
                  <span className="green-text">(OK)</span>
                ) : (
                  <span className="orange-text">
                    ({deltaComposicao > 0 ? `falta ${fmt1(deltaComposicao)}` : `sobra ${fmt1(Math.abs(deltaComposicao))}`} %)
                  </span>
                )}
              </div>

              <div className="rsu-sum ok">
                Lo calculado: <b>{fmt4(loCalculado)}</b>
                <span className="rsu-lo-unit">CH4/t RSU</span>
              </div>
            </div>
          </div>
        </section>

        {/* Gráfico full width */}
        <section className="card glow rsu-chart full-width">
          <h3 className="rsu-section-title">Produção de RSU (T/ano)</h3>

          {/* container específico para evitar conflitos com .chart-container global */}
          <div className="rsu-chart-container">
            <ResponsiveLine
              data={series.nivo}
              margin={
                isMobile
                  ? { top: 16, right: 16, bottom: 36, left: 46 }
                  : { top: 20, right: 24, bottom: 44, left: 70 }
              }
              xScale={{ type: "point" }}
              yScale={{ type: "linear", min: 0, max: "auto", stacked: false, reverse: false }}
              curve="monotoneX"
              axisTop={null}
              axisRight={null}
              axisBottom={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: isMobile ? -30 : 0,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: 0,
                tickValues: isMobile ? 4 : 6,
              }}
              enablePoints={!isMobile}
              pointSize={6}
              pointColor="#1b5e20"
              pointBorderWidth={2}
              pointBorderColor="#fff"
              enableArea={true}
              areaOpacity={isMobile ? 0.18 : 0.25}
              useMesh={true}
              colors={["#1b5e20"]}
              theme={{
                textColor: "#1b3c2e",
                fontSize: isMobile ? 11 : 12,
                grid: { line: { stroke: "#e0e0e0", strokeWidth: 1 } },
              }}
              tooltip={({ point }) => (
                <div
                  style={{
                    background: "white",
                    padding: "8px 10px",
                    border: "1px solid #1b5e20",
                    borderRadius: "8px",
                    color: "#1b5e20",
                    fontWeight: 700,
                  }}
                >
                  {point.data.xFormatted}: {point.data.yFormatted} t/ano
                </div>
              )}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
