import React, { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { useDashboard } from "../context/DashboardContext.jsx";
import { fetchLandfillCalculation } from "../utils/landfillCalcApi.js";
import { DEFAULT_ANO_FINAL, normalizeLandfillConfig } from "../utils/landfillModel.js";
import "../styles/Charts.css";


const IBGE_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades";
const IBGE_MALHAS_V3 = "https://servicodados.ibge.gov.br/api/v3/malhas";
const CALC_END_YEAR = DEFAULT_ANO_FINAL;
const MUNICIPIOS_BY_UF_CACHE = new Map();

function toNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : fallback;
}

function rangeYears(from, to) {
  const out = [];
  for (let y = from; y <= to; y += 1) out.push(y);
  return out;
}

function cityKey(row) {
  return `${row.uf}::${row.nome}`;
}

function cityShortName(nome) {
  return String(nome).replace(/\s*\([A-Z]{2}\)\s*$/, "").trim();
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`)
    .join(",")}}`;
}

function fmtInt(n) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));
}

function fmtTon(n) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function norm(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function getMunicipioId(ufSigla, nomeMunicipioComUf) {
  const nomeMunicipio = String(nomeMunicipioComUf).replace(/\s*\(.+\)\s*$/, "");
  let listPromise = MUNICIPIOS_BY_UF_CACHE.get(ufSigla);
  if (!listPromise) {
    listPromise = fetch(`${IBGE_LOCALIDADES}/estados/${ufSigla}/municipios`, {
      headers: { Accept: "application/json" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`IBGE localidades HTTP ${r.status}`);
      return r.json();
    }).catch((error) => {
      MUNICIPIOS_BY_UF_CACHE.delete(ufSigla);
      throw error;
    });
    MUNICIPIOS_BY_UF_CACHE.set(ufSigla, listPromise);
  }

  const list = await listPromise;
  const alvo = norm(nomeMunicipio);
  const hit = list.find((m) => norm(m.nome) === alvo) || list.find((m) => norm(m.nome).startsWith(alvo));
  if (!hit) throw new Error(`Município não encontrado: ${nomeMunicipio}/${ufSigla}`);
  return hit.id;
}

async function getMunicipioGeoJSON(municipioId, qualidade = "intermediaria") {
  const qualities = [qualidade, "simplificada", "basica"];
  let lastError = null;

  for (const q of qualities) {
    try {
      const url =
        `${IBGE_MALHAS_V3}/municipios/${municipioId}` +
        `?formato=application/vnd.geo+json&qualidade=${q}`;
      const gjResp = await fetch(url, {
        headers: { Accept: "application/vnd.geo+json" },
      });
      if (!gjResp.ok) throw new Error(`IBGE malha HTTP ${gjResp.status}`);
      const gj = await gjResp.json();

      if (gj.type === "FeatureCollection") return gj;
      if (gj.type === "Feature") return { type: "FeatureCollection", features: [gj] };
      throw new Error("GeoJSON inesperado da malha do IBGE");
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Falha ao carregar malha do IBGE");
}

function MethaneMap({ rows, selectedCityKey, onSelectCity }) {
  const mapRef = useRef(null);
  const mapWrapRef = useRef(null);
  const loadingKeysRef = useRef(new Set());
  const [geoCache, setGeoCache] = useState(() => new Map());
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [errorKeys, setErrorKeys] = useState(new Map());

  useEffect(() => {
    const validKeys = new Set(rows.map((r) => cityKey(r)));
    loadingKeysRef.current = new Set([...loadingKeysRef.current].filter((k) => validKeys.has(k)));
    setGeoCache((prev) => new Map([...prev.entries()].filter(([k]) => validKeys.has(k))));
    setErrorKeys((prev) => new Map([...prev.entries()].filter(([k]) => validKeys.has(k))));
    setLoadingKeys((prev) => new Set([...prev].filter((k) => validKeys.has(k))));
  }, [rows]);

  useEffect(() => {
    const wanted = rows.map((r) => cityKey(r));
    const missing = wanted.filter((k) => !geoCache.has(k) && !loadingKeysRef.current.has(k));
    if (missing.length === 0) return;

    let active = true;
    missing.forEach((k) => loadingKeysRef.current.add(k));
    setLoadingKeys((prev) => new Set([...prev, ...missing]));

    (async () => {
      const loadedEntries = [];
      const failedEntries = [];

      await Promise.all(
        missing.map(async (k) => {
          const [uf, nome] = k.split("::");
          try {
            const id = await getMunicipioId(uf, nome);
            const gj = await getMunicipioGeoJSON(id, "intermediaria");
            loadedEntries.push([k, gj]);
          } catch (e) {
            failedEntries.push([k, e?.message || "Erro ao carregar malha"]);
          }
        })
      );

      if (!active) return;

      setGeoCache((prev) => {
        const next = new Map(prev);
        loadedEntries.forEach(([k, gj]) => next.set(k, gj));
        return next;
      });

      setErrorKeys((prev) => {
        const next = new Map(prev);
        loadedEntries.forEach(([k]) => next.delete(k));
        failedEntries.forEach(([k, msg]) => next.set(k, msg));
        return next;
      });

      setLoadingKeys((prev) => {
        const next = new Set(prev);
        missing.forEach((k) => next.delete(k));
        return next;
      });
      missing.forEach((k) => loadingKeysRef.current.delete(k));
    })();

    return () => {
      active = false;
      missing.forEach((k) => loadingKeysRef.current.delete(k));
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        missing.forEach((k) => next.delete(k));
        return next;
      });
    };
  }, [rows, geoCache]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedCityKey) {
      const fc = geoCache.get(selectedCityKey);
      if (fc?.features?.length) {
        const g = L.geoJSON(fc);
        const b = g.getBounds();
        if (b.isValid()) {
          map.flyToBounds(b.pad(0.2), { duration: 1.1 });
          return;
        }
      }
    }

    const all = [];
    rows.forEach((r) => {
      const fc = geoCache.get(cityKey(r));
      if (fc?.features?.length) all.push(...fc.features);
    });

    if (all.length) {
      const g = L.geoJSON({ type: "FeatureCollection", features: all });
      const b = g.getBounds();
      if (b.isValid()) {
        map.fitBounds(b.pad(0.12));
        return;
      }
    }

    map.setView([-14.235, -51.9253], 4);
  }, [rows, geoCache, selectedCityKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const tick = () => map.invalidateSize();
    const t = setTimeout(tick, 0);
    window.addEventListener("resize", tick);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", tick);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const wrap = mapWrapRef.current;
    if (!map || !wrap || typeof ResizeObserver === "undefined") return undefined;
    const obs = new ResizeObserver(() => map.invalidateSize());
    obs.observe(wrap);
    return () => obs.disconnect();
  }, []);

  const visibleErrorCount = useMemo(
    () => rows.reduce((acc, row) => acc + (errorKeys.has(cityKey(row)) ? 1 : 0), 0),
    [rows, errorKeys]
  );

  const styleFor = (idx, isActive) => {
    const palette = ["#1b5e20", "#2e7d32", "#43a047", "#66bb6a", "#81c784", "#a5d6a7"];
    if (isActive) {
      return {
        color: "#ef6c00",
        fillColor: "#ffb74d",
        weight: 3.2,
        fillOpacity: 0.5,
      };
    }
    const color = palette[idx % palette.length];
    return {
      color,
      fillColor: color,
      weight: 2.3,
      fillOpacity: 0.25,
    };
  };

  return (
    <div className="charts-map-shell">
      <div ref={mapWrapRef} className="map-wrap">
        <MapContainer
          whenCreated={(map) => {
            mapRef.current = map;
          }}
          center={[-14.235, -51.9253]}
          zoom={4}
          scrollWheelZoom
          className="map-el"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap colaboradores"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {rows.map((row, idx) => {
            const key = cityKey(row);
            const fc = geoCache.get(key);
            if (!fc) return null;
            const active = selectedCityKey === key;
            return (
              <GeoJSON
                key={key}
                data={fc}
                style={() => styleFor(idx, active)}
                eventHandlers={{
                  click: () => onSelectCity(key),
                }}
              />
            );
          })}
        </MapContainer>
        {loadingKeys.size > 0 && <div className="map-loading">Carregando {loadingKeys.size} cidade(s)...</div>}
        {visibleErrorCount > 0 && (
          <div className="map-error">
            Algumas cidades não carregaram no mapa ({visibleErrorCount}).
          </div>
        )}
      </div>
    </div>
  );
}

export default function Charts() {
  const [loaded, setLoaded] = useState(false);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedCityKey, setSelectedCityKey] = useState(null);
  const [compareCityKeys, setCompareCityKeys] = useState([]);
  const [cityToAddKey, setCityToAddKey] = useState("");
  const [landfillCalc, setLandfillCalc] = useState(null);
  const [loadingLandfillCalc, setLoadingLandfillCalc] = useState(false);
  const [landfillCalcError, setLandfillCalcError] = useState(null);
  const hydratedChartScenariosRef = useRef(new Set());

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

  const currentScenario = useMemo(
    () => scenarios.find((s) => String(s.id) === String(currentScenarioId)) || null,
    [scenarios, currentScenarioId]
  );
  const rows = useMemo(() => currentScenario?.rows || [], [currentScenario]);

  useEffect(() => {
    if (!currentScenarioId) return;
    const hydrated = hydratedChartScenariosRef.current;
    if (hydrated.has(currentScenarioId)) return;

    const savedChart = rsuByScenario?.[currentScenarioId]?.chart;
    const nextYear = Number(savedChart?.selectedYear);
    const normalizedYear = Number.isFinite(nextYear) ? nextYear : null;
    const normalizedCityKey =
      typeof savedChart?.selectedCityKey === "string" && savedChart.selectedCityKey.trim()
        ? savedChart.selectedCityKey
        : null;
    const normalizedCompareCityKeys = Array.isArray(savedChart?.compareCityKeys)
      ? [...new Set(savedChart.compareCityKeys.filter((k) => typeof k === "string" && k.trim()))]
      : [];

    setSelectedYear((prev) => (prev === normalizedYear ? prev : normalizedYear));
    setSelectedCityKey((prev) => (prev === normalizedCityKey ? prev : normalizedCityKey));
    setCompareCityKeys((prev) =>
      stableSerialize(prev) === stableSerialize(normalizedCompareCityKeys)
        ? prev
        : normalizedCompareCityKeys
    );

    hydrated.add(currentScenarioId);
  }, [currentScenarioId, rsuByScenario]);

  const scenarioEntry = useMemo(
    () => (currentScenarioId ? rsuByScenario?.[currentScenarioId] : null),
    [currentScenarioId, rsuByScenario]
  );

  const config = useMemo(() => normalizeLandfillConfig(scenarioEntry?.config), [scenarioEntry?.config]);
  const configSignature = useMemo(() => stableSerialize(config), [config]);

  const years = useMemo(() => {
    const fromConfig = Number(config.vidaInicio);
    const toConfig = Number(config.vidaFim);
    if (Number.isFinite(fromConfig) && Number.isFinite(toConfig) && fromConfig <= toConfig) {
      return rangeYears(fromConfig, Math.max(fromConfig, CALC_END_YEAR));
    }

    const fromScenario = Number(currentScenario?.anoInicial);
    const toScenario = Number(currentScenario?.anoFinal);
    if (Number.isFinite(fromScenario) && Number.isFinite(toScenario) && fromScenario <= toScenario) {
      return rangeYears(fromScenario, Math.max(fromScenario, CALC_END_YEAR));
    }

    const set = new Set();
    rows.forEach((r) => {
      Object.keys(r?.series || {}).forEach((y) => {
        const ny = Number(y);
        if (Number.isFinite(ny)) set.add(ny);
      });
    });

    if (set.size === 0) return [];
    return Array.from(set).sort((a, b) => a - b);
  }, [rows, currentScenario, config.vidaInicio, config.vidaFim]);

  useEffect(() => {
    if (!years.length) {
      setSelectedYear(null);
      return;
    }
    if (!selectedYear || !years.includes(selectedYear)) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  useEffect(() => {
    if (!currentScenarioId || !years.length) {
      setLandfillCalc(null);
      setLandfillCalcError(null);
      setLoadingLandfillCalc(false);
      return;
    }

    let cancelled = false;
    setLoadingLandfillCalc(true);
    setLandfillCalcError(null);

    fetchLandfillCalculation({
      rows,
      config,
      anoInicial: Math.round(toNumber(config.vidaInicio, years[0])),
      anoFinal: Math.max(
        Math.round(toNumber(config.vidaInicio, years[0])),
        Math.round(toNumber(config.vidaFim, years[0]))
      ),
      maxYear: Math.max(CALC_END_YEAR, years[0]),
    })
      .then((result) => {
        if (cancelled) return;
        setLandfillCalc(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setLandfillCalc(null);
        setLandfillCalcError(error?.message || "Erro ao calcular metano no servidor");
      })
      .finally(() => {
        if (!cancelled) setLoadingLandfillCalc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentScenarioId, rows, years, configSignature]);

  const annualData = useMemo(() => {
    const byYear = new Map(
      (landfillCalc?.total?.rows || []).map((row) => [Number(row?.ano), row])
    );

    return years.map((year) => {
      const calcRow = byYear.get(year);
      return {
        ano: year,
        populacao: Number(calcRow?.pop) || 0,
        residuoTAno: Number(calcRow?.residuoTAno) || 0,
        metanoTAno: Number(calcRow?.metanoTAno) || 0,
      };
    });
  }, [years, landfillCalc]);

  const cityRowsByKey = useMemo(() => {
    const map = new Map();
    (landfillCalc?.cities || []).forEach((city) => {
      map.set(city.key, city.rows || []);
    });
    return map;
  }, [landfillCalc]);

  const cityData = useMemo(() => {
    if (!selectedYear) return [];

    return rows
      .map((row) => {
        const key = cityKey(row);
        const cityRows = cityRowsByKey.get(key) || [];
        const selectedRow = cityRows.find((item) => Number(item?.ano) === selectedYear);
        return {
          key,
          uf: row.uf,
          nome: cityShortName(row.nome),
          populacao: Number(selectedRow?.pop) || 0,
          residuoTAno: Number(selectedRow?.residuoTAno) || 0,
          metanoTAno: Number(selectedRow?.metanoTAno) || 0,
        };
      })
      .sort((a, b) => b.metanoTAno - a.metanoTAno);
  }, [rows, selectedYear, cityRowsByKey]);

  useEffect(() => {
    if (!selectedYear) return;

    if (!cityData.length) {
      if (!rows.length) {
        setCompareCityKeys([]);
      }
      return;
    }

    setCompareCityKeys((prev) => {
      const valid = prev.filter((k) => cityData.some((c) => c.key === k));
      if (valid.length > 0) return valid;
      return cityData.slice(0, 2).map((c) => c.key);
    });
  }, [cityData, selectedYear, rows.length]);

  const addableCities = useMemo(
    () => cityData.filter((city) => !compareCityKeys.includes(city.key)),
    [cityData, compareCityKeys]
  );

  useEffect(() => {
    if (!addableCities.length) {
      setCityToAddKey("");
      return;
    }
    if (!cityToAddKey || !addableCities.some((city) => city.key === cityToAddKey)) {
      setCityToAddKey(addableCities[0].key);
    }
  }, [addableCities, cityToAddKey]);

  const comparedCities = useMemo(
    () =>
      compareCityKeys
        .map((key) => cityData.find((city) => city.key === key))
        .filter(Boolean),
    [compareCityKeys, cityData]
  );

  const cityComparisonSeries = useMemo(() => {
    const palette = ["#ef6c00", "#00897b", "#5e35b1", "#039be5", "#f4511e", "#3949ab", "#43a047", "#8e24aa"];
    return comparedCities.map((city, idx) => ({
      key: city.key,
      nome: city.nome,
      color: palette[idx % palette.length],
    }));
  }, [comparedCities]);

  const cityComparisonAreaData = useMemo(() => {
    const annualByYear = new Map(annualData.map((row) => [Number(row.ano), row]));

    return years.map((year) => {
      const point = {
        ano: year,
        total: Number(annualByYear.get(year)?.metanoTAno) || 0,
      };

      cityComparisonSeries.forEach((series) => {
        const rowsByCity = cityRowsByKey.get(series.key) || [];
        const cityYearRow = rowsByCity.find((r) => Number(r?.ano) === year);
        point[series.key] = Number(cityYearRow?.metanoTAno) || 0;
      });

      return point;
    });
  }, [years, annualData, cityComparisonSeries, cityRowsByKey]);

  useEffect(() => {
    if (!cityData.length) {
      setSelectedCityKey(null);
      return;
    }
    if (!selectedCityKey || !cityData.some((c) => c.key === selectedCityKey)) {
      setSelectedCityKey(cityData[0].key);
    }
  }, [cityData, selectedCityKey]);

  useEffect(() => {
    if (!currentScenarioId) return;
    if (!hydratedChartScenariosRef.current.has(currentScenarioId)) return;

    const nextChart = {
      selectedYear: Number.isFinite(Number(selectedYear)) ? Number(selectedYear) : null,
      selectedCityKey:
        typeof selectedCityKey === "string" && selectedCityKey.trim() ? selectedCityKey : null,
      compareCityKeys,
    };

    setRsuByScenario((prev) => {
      const safePrev = prev || {};
      const currentEntry = safePrev[currentScenarioId] || {};
      const prevChartSig = stableSerialize(currentEntry.chart || {});
      const nextChartSig = stableSerialize(nextChart);
      if (currentEntry.chart && prevChartSig === nextChartSig) {
        return safePrev;
      }

      return {
        ...safePrev,
        [currentScenarioId]: {
          ...currentEntry,
          chart: nextChart,
        },
      };
    });
  }, [currentScenarioId, selectedYear, selectedCityKey, compareCityKeys, setRsuByScenario]);

  const selectedCity = useMemo(
    () => cityData.find((c) => c.key === selectedCityKey) || null,
    [cityData, selectedCityKey]
  );

  const selectedYearTotals = useMemo(
    () => annualData.find((d) => d.ano === selectedYear) || null,
    [annualData, selectedYear]
  );

  const handleAddCompareCity = () => {
    if (!cityToAddKey) return;
    setCompareCityKeys((prev) => (prev.includes(cityToAddKey) ? prev : [...prev, cityToAddKey]));
  };

  const handleRemoveCompareCity = (key) => {
    setCompareCityKeys((prev) => prev.filter((cityKeyValue) => cityKeyValue !== key));
  };

  if (loadingUser) {
    return (
      <div className={`home-container ${loaded ? "fade-in" : ""}`}>
        <p>Carregando dados do usuário...</p>
      </div>
    );
  }

  return (
    <div className={`home-container ${loaded ? "fade-in" : ""}`}>
      <header className="home-header">
        <div>
          <h1>Gráficos de Metano</h1>
          <p>Produção total, produção por cidade e detalhamento geográfico por município.</p>
        </div>

        <div className="header-actions">
          <div className="select-wrap compact charts-year-select">
            <select
              value={selectedYear ?? ""}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              disabled={!years.length}
            >
              {!years.length && <option value="">Sem anos</option>}
              {years.map((y) => (
                <option key={y} value={y}>
                  Ano {y}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
        </div>
      </header>

      <div className="charts-period-chip">
        Operação do aterro: {config.vidaInicio}–{config.vidaFim} | Projeção de metano até {CALC_END_YEAR}
      </div>

      {loadingLandfillCalc && (
        <small style={{ display: "block", marginBottom: 8 }}>
          Atualizando cálculo de metano no servidor...
        </small>
      )}
      {landfillCalcError && (
        <small className="error-text" style={{ display: "block", marginBottom: 8 }}>
          {landfillCalcError}
        </small>
      )}

      {!rows.length ? (
        <section className="card glow charts-empty">
          <h3>Sem cidades no cenário selecionado</h3>
          <p>Adicione cidades na página inicial para visualizar os gráficos e o mapa de metano.</p>
        </section>
      ) : (
        <>
          <div className="exp-metrics-row charts-metrics-row">
            <div className="exp-metric-card glow">
              <h3>Cidades no cenário</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">location_city</span>
                <div className="exp-text">
                  <h2>{rows.length}</h2>
                </div>
              </div>
            </div>

            <div className="exp-metric-card glow">
              <h3>Metano Total ({selectedYear})</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">bubble_chart</span>
                <div className="exp-text">
                  <h2>{fmtTon(selectedYearTotals?.metanoTAno || 0)} t</h2>
                </div>
              </div>
            </div>

            <div className="exp-metric-card glow">
              <h3>Resíduo Total ({selectedYear})</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">delete_outline</span>
                <div className="exp-text">
                  <h2>{fmtTon(selectedYearTotals?.residuoTAno || 0)} t</h2>
                </div>
              </div>
            </div>
          </div>

          <section className="card glow charts-compare-card">
            <div className="charts-compare-header">
              <h3>Cidades no comparativo do gráfico</h3>
              <p>Adicione ou remova cidades para comparar apenas as que você quiser.</p>
            </div>

            <div className="charts-compare-controls">
              <div className="select-wrap compact">
                <select
                  value={cityToAddKey}
                  onChange={(e) => setCityToAddKey(e.target.value)}
                  disabled={!addableCities.length}
                >
                  {!addableCities.length && <option value="">Sem cidades disponíveis</option>}
                  {addableCities.map((city) => (
                    <option key={city.key} value={city.key}>
                      {city.nome} ({city.uf})
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddCompareCity}
                disabled={!cityToAddKey}
              >
                Adicionar ao gráfico
              </button>
            </div>

            <div className="charts-compare-tags">
              {comparedCities.length === 0 ? (
                <span className="charts-compare-empty">Nenhuma cidade selecionada.</span>
              ) : (
                comparedCities.map((city) => (
                  <div key={city.key} className={`charts-compare-tag ${city.key === selectedCityKey ? "is-active" : ""}`}>
                    <button
                      type="button"
                      className="charts-compare-tag-main"
                      onClick={() => setSelectedCityKey(city.key)}
                      title="Focar cidade"
                    >
                      {city.nome} ({city.uf})
                    </button>
                    <button
                      type="button"
                      className="charts-compare-tag-remove"
                      onClick={() => handleRemoveCompareCity(city.key)}
                      title="Remover do comparativo"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <main className="home-grid charts-grid">
            <section className="card glow charts-total-card">
              <h3>Produção Total de Metano e Comparação por Cidade (t/ano)</h3>
              <div className="charts-total-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cityComparisonAreaData} margin={{ top: 12, right: 20, bottom: 12, left: 4 }}>
                    <defs>
                      <linearGradient id="methaneArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2e7d32" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2e7d32" stopOpacity={0.06} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#dfe9e3" strokeDasharray="3 3" />
                    <XAxis dataKey="ano" tickMargin={8} />
                    <YAxis tickFormatter={(v) => fmtTon(v)} width={90} />
                    <Legend />
                    <Tooltip
                      formatter={(value, name) => [`${fmtTon(value)} t`, name]}
                      labelFormatter={(label) => `Ano ${label}`}
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #1b5e20",
                        borderRadius: 8,
                        color: "#1b5e20",
                        fontWeight: 700,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total"
                      stroke="#1b5e20"
                      strokeWidth={2.4}
                      fill="url(#methaneArea)"
                      fillOpacity={1}
                      dot={false}
                    />
                    {cityComparisonSeries.map((series) => (
                      <Area
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.nome}
                        stroke={series.color}
                        fill={series.color}
                        fillOpacity={0.12}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </main>

          <section className="card glow charts-map-card">
            <div className="map-card-header">
              <h3>Mapa Interativo de Produção por Cidade</h3>
            </div>

            <div className="charts-map-layout">
              <MethaneMap
                rows={rows}
                selectedCityKey={selectedCityKey}
                onSelectCity={setSelectedCityKey}
              />

              <aside className="charts-city-info">
                <h4>Cidade selecionada</h4>
                {!selectedCity ? (
                  <p>Clique em uma cidade no mapa para ver os indicadores.</p>
                ) : (
                  <div className="charts-city-info-content">
                    <p className="charts-city-name">
                      {selectedCity.nome} ({selectedCity.uf})
                    </p>
                    <div className="charts-city-stat">
                      <span>População ({selectedYear})</span>
                      <strong>{fmtInt(selectedCity.populacao)}</strong>
                    </div>
                    <div className="charts-city-stat">
                      <span>Produção de resíduo</span>
                      <strong>{fmtTon(selectedCity.residuoTAno)} t/ano</strong>
                    </div>
                    <div className="charts-city-stat">
                      <span>Produção de metano</span>
                      <strong>{fmtTon(selectedCity.metanoTAno)} t/ano</strong>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
