import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { useDashboard } from "../context/DashboardContext.jsx";
import { fetchLandfillCalculation } from "../utils/landfillCalcApi.js";
import "../styles/Energy.css";

const DEFAULT_CONFIG = {
  regiao: "Nordeste",
  geracaoKgAnoHab: 328.3,
  taxaColetaPct: 100,
  kMetano: 0.05,
  vidaInicio: 2000,
  vidaFim: 2060,
  composicao: {
    papel: 17.1,
    organica: 44.9,
    plastico: 10.8,
    texteis: 2.6,
    madeira: 4.7,
    metal: 2.9,
    vidro: 3.3,
    borracha: 0.7,
    outros: 13.0,
  },
};

const GENERATOR_TEMPLATES = [
  {
    id: "motor-gerador",
    nome: "Motor Gerador",
    tipo: "Motor de combustao interna",
    eficienciaEletricaPct: 38,
    potenciaNominalKw: 1200,
    disponibilidadePct: 92,
    energiaEspecificaKwhPorTonCh4: 13890,
  },
  {
    id: "microturbina",
    nome: "Microturbina",
    tipo: "Microturbina a gas",
    eficienciaEletricaPct: 30,
    potenciaNominalKw: 500,
    disponibilidadePct: 90,
    energiaEspecificaKwhPorTonCh4: 13890,
  },
  {
    id: "turbina-gas",
    nome: "Turbina a Gas",
    tipo: "Turbina industrial",
    eficienciaEletricaPct: 34,
    potenciaNominalKw: 2500,
    disponibilidadePct: 89,
    energiaEspecificaKwhPorTonCh4: 13890,
  },
  {
    id: "peltier",
    nome: "Celula de Peltier",
    tipo: "Geracao termoeletrica",
    eficienciaEletricaPct: 6,
    potenciaNominalKw: 40,
    disponibilidadePct: 85,
    energiaEspecificaKwhPorTonCh4: 13890,
  },
];

const IBGE_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades";
const IBGE_MALHAS_V3 = "https://servicodados.ibge.gov.br/api/v3/malhas";
const CALC_END_YEAR = 2060;
const ENERGY_SERIES_COLORS = ["#1b5e20", "#2e7d32", "#43a047", "#66bb6a", "#81c784", "#a5d6a7"];
const DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH = 180;

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

function normalizeConfig(config) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    composicao: {
      ...DEFAULT_CONFIG.composicao,
      ...(config?.composicao || {}),
    },
  };

  return {
    regiao: String(merged.regiao || DEFAULT_CONFIG.regiao),
    geracaoKgAnoHab: toNumber(merged.geracaoKgAnoHab, DEFAULT_CONFIG.geracaoKgAnoHab),
    taxaColetaPct: toNumber(merged.taxaColetaPct, DEFAULT_CONFIG.taxaColetaPct),
    kMetano: toNumber(merged.kMetano, DEFAULT_CONFIG.kMetano),
    vidaInicio: Math.round(toNumber(merged.vidaInicio, DEFAULT_CONFIG.vidaInicio)),
    vidaFim: Math.round(toNumber(merged.vidaFim, DEFAULT_CONFIG.vidaFim)),
    composicao: {
      papel: toNumber(merged.composicao?.papel, DEFAULT_CONFIG.composicao.papel),
      organica: toNumber(merged.composicao?.organica, DEFAULT_CONFIG.composicao.organica),
      plastico: toNumber(merged.composicao?.plastico, DEFAULT_CONFIG.composicao.plastico),
      texteis: toNumber(merged.composicao?.texteis, DEFAULT_CONFIG.composicao.texteis),
      madeira: toNumber(merged.composicao?.madeira, DEFAULT_CONFIG.composicao.madeira),
      metal: toNumber(merged.composicao?.metal, DEFAULT_CONFIG.composicao.metal),
      vidro: toNumber(merged.composicao?.vidro, DEFAULT_CONFIG.composicao.vidro),
      borracha: toNumber(merged.composicao?.borracha, DEFAULT_CONFIG.composicao.borracha),
      outros: toNumber(merged.composicao?.outros, DEFAULT_CONFIG.composicao.outros),
    },
  };
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

function generatorDraftFromTemplate(template = GENERATOR_TEMPLATES[0]) {
  return {
    nome: template.nome,
    tipo: template.tipo,
    eficienciaEletricaPct: String(template.eficienciaEletricaPct),
    potenciaNominalKw: String(template.potenciaNominalKw),
    disponibilidadePct: String(template.disponibilidadePct),
    energiaEspecificaKwhPorTonCh4: String(template.energiaEspecificaKwhPorTonCh4),
  };
}

function normalizeGenerator(raw, fallbackId = "gen-default") {
  return {
    id: String(raw?.id || fallbackId),
    nome: String(raw?.nome || "Gerador"),
    tipo: String(raw?.tipo || "Personalizado"),
    eficienciaEletricaPct: Math.min(100, Math.max(0, toNumber(raw?.eficienciaEletricaPct, 30))),
    potenciaNominalKw: Math.max(0, toNumber(raw?.potenciaNominalKw, 100)),
    disponibilidadePct: Math.min(100, Math.max(0, toNumber(raw?.disponibilidadePct, 90))),
    energiaEspecificaKwhPorTonCh4: Math.max(1, toNumber(raw?.energiaEspecificaKwhPorTonCh4, 13890)),
  };
}

function createGeneratorFromTemplate(template) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return normalizeGenerator(
    {
      ...template,
      id: `gen-${template.id}-${stamp}`,
    },
    `gen-${template.id}-${stamp}`
  );
}

function generatorEnergyFromMethane(methaneTAno, generator) {
  if (!generator) {
    return {
      energiaGeradaKwh: 0,
      energiaGeradaMwh: 0,
      energiaPotencialKwh: 0,
      limitePorPotenciaKwh: 0,
    };
  }

  const methaneEnergyKwh = methaneTAno * generator.energiaEspecificaKwhPorTonCh4;
  const energiaPosEficienciaKwh = methaneEnergyKwh * (generator.eficienciaEletricaPct / 100);
  const energiaDisponivelKwh = energiaPosEficienciaKwh * (generator.disponibilidadePct / 100);
  const limitePorPotenciaKwh =
    generator.potenciaNominalKw * 8760 * (generator.disponibilidadePct / 100);

  const energiaGeradaKwh = Math.min(energiaDisponivelKwh, limitePorPotenciaKwh);

  return {
    energiaGeradaKwh,
    energiaGeradaMwh: energiaGeradaKwh / 1000,
    energiaPotencialKwh: energiaDisponivelKwh,
    limitePorPotenciaKwh,
  };
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

function fmtMwh(n) {
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
  const list = await fetch(`${IBGE_LOCALIDADES}/estados/${ufSigla}/municipios`).then((r) => r.json());
  const alvo = norm(nomeMunicipio);
  const hit = list.find((m) => norm(m.nome) === alvo) || list.find((m) => norm(m.nome).startsWith(alvo));
  if (!hit) throw new Error(`Município não encontrado: ${nomeMunicipio}/${ufSigla}`);
  return hit.id;
}

async function getMunicipioGeoJSON(municipioId, qualidade = "intermediaria") {
  const url =
    `${IBGE_MALHAS_V3}/municipios/${municipioId}` +
    `?formato=application/vnd.geo+json&qualidade=${qualidade}`;
  const gj = await fetch(url, {
    headers: { Accept: "application/vnd.geo+json" },
  }).then((r) => r.json());

  if (gj.type === "FeatureCollection") return gj;
  if (gj.type === "Feature") return { type: "FeatureCollection", features: [gj] };
  throw new Error("GeoJSON inesperado da malha do IBGE");
}

function EnergyMap({ rows, selectedCityKey, onSelectCity }) {
  const mapRef = useRef(null);
  const [geoCache, setGeoCache] = useState(() => new Map());
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [errorKeys, setErrorKeys] = useState(new Map());

  useEffect(() => {
    const wanted = rows.map((r) => cityKey(r));
    const missing = wanted.filter((k) => !geoCache.has(k) && !loadingKeys.has(k));
    if (missing.length === 0) return;

    setLoadingKeys((prev) => new Set([...prev, ...missing]));
    (async () => {
      const newCache = new Map(geoCache);
      const newErrors = new Map(errorKeys);
      await Promise.all(
        missing.map(async (k) => {
          const [uf, nome] = k.split("::");
          try {
            const id = await getMunicipioId(uf, nome);
            const gj = await getMunicipioGeoJSON(id, "intermediaria");
            newCache.set(k, gj);
            newErrors.delete(k);
          } catch (e) {
            newErrors.set(k, e?.message || "Erro ao carregar malha");
          }
        })
      );

      setGeoCache(newCache);
      setErrorKeys(newErrors);
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        missing.forEach((k) => next.delete(k));
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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

  const styleFor = (idx, isActive) => {
    const palette = ["#1b5e20", "#2e7d32", "#43a047", "#66bb6a", "#81c784", "#a5d6a7"];
    if (isActive) {
      return { color: "#ef6c00", fillColor: "#ffb74d", weight: 3.2, fillOpacity: 0.5 };
    }
    const color = palette[idx % palette.length];
    return { color, fillColor: color, weight: 2.3, fillOpacity: 0.25 };
  };

  return (
    <div className="energy-map-shell">
      <div className="map-wrap">
        <MapContainer
          center={[-14.235, -51.9253]}
          zoom={4}
          scrollWheelZoom
          className="map-el"
          whenCreated={(map) => {
            mapRef.current = map;
          }}
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
                eventHandlers={{ click: () => onSelectCity(key) }}
              />
            );
          })}
        </MapContainer>

        {loadingKeys.size > 0 && <div className="map-loading">Carregando {loadingKeys.size} cidade(s)...</div>}
        {errorKeys.size > 0 && <div className="map-error">Algumas cidades nao carregaram no mapa.</div>}
      </div>
    </div>
  );
}

export default function Energy() {
  const [loaded, setLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth <= 768 : false)
  );
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedCityKey, setSelectedCityKey] = useState(null);
  const [customDraft, setCustomDraft] = useState(() => generatorDraftFromTemplate());
  const [generators, setGenerators] = useState([]);
  const [activeGeneratorId, setActiveGeneratorId] = useState(null);
  const [compareGeneratorIds, setCompareGeneratorIds] = useState([]);
  const [residentialConsumptionKwhMonth, setResidentialConsumptionKwhMonth] = useState(
    DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH
  );
  const [landfillCalc, setLandfillCalc] = useState(null);
  const [loadingLandfillCalc, setLoadingLandfillCalc] = useState(false);
  const [landfillCalcError, setLandfillCalcError] = useState(null);
  const hydratedEnergyScenariosRef = useRef(new Set());

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
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const currentScenario = useMemo(
    () => scenarios.find((s) => String(s.id) === String(currentScenarioId)) || null,
    [scenarios, currentScenarioId]
  );
  const rows = useMemo(() => currentScenario?.rows || [], [currentScenario]);

  useEffect(() => {
    if (!currentScenarioId) return;
    const hydrated = hydratedEnergyScenariosRef.current;
    if (hydrated.has(currentScenarioId)) return;

    const entry = rsuByScenario?.[currentScenarioId];
    const savedEnergy = entry?.energy;
    if (savedEnergy && Array.isArray(savedEnergy.generators) && savedEnergy.generators.length) {
      const normalized = savedEnergy.generators.map((g, idx) => normalizeGenerator(g, `gen-saved-${idx}`));
      const nextSig = stableSerialize(normalized);
      const activeExists = normalized.some((g) => g.id === savedEnergy.activeGeneratorId);
      const desiredActiveId = activeExists ? savedEnergy.activeGeneratorId : normalized[0].id;
      const normalizedCompare = Array.isArray(savedEnergy.compareGeneratorIds)
        ? savedEnergy.compareGeneratorIds.filter((id) => normalized.some((g) => g.id === id))
        : [];
      const nextCompareIds = normalizedCompare.length
        ? normalizedCompare
        : normalized.slice(0, 3).map((g) => g.id);
      const nextYear = Number(savedEnergy.selectedYear);
      const normalizedYear = Number.isFinite(nextYear) ? nextYear : null;
      const normalizedCityKey =
        typeof savedEnergy.selectedCityKey === "string" && savedEnergy.selectedCityKey.trim()
          ? savedEnergy.selectedCityKey
          : null;
      const normalizedResidentialConsumption = Math.max(
        1,
        toNumber(savedEnergy.residentialConsumptionKwhMonth, DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH)
      );

      setGenerators((prev) => (stableSerialize(prev) === nextSig ? prev : normalized));
      setActiveGeneratorId((prev) => (prev === desiredActiveId ? prev : desiredActiveId));
      setCompareGeneratorIds((prev) =>
        stableSerialize(prev) === stableSerialize(nextCompareIds) ? prev : nextCompareIds
      );
      setSelectedYear((prev) => (prev === normalizedYear ? prev : normalizedYear));
      setSelectedCityKey((prev) => (prev === normalizedCityKey ? prev : normalizedCityKey));
      setResidentialConsumptionKwhMonth((prev) =>
        prev === normalizedResidentialConsumption ? prev : normalizedResidentialConsumption
      );
      hydrated.add(currentScenarioId);
      return;
    }

    const defaultGenerator = normalizeGenerator(
      { ...GENERATOR_TEMPLATES[0], id: `gen-default-${currentScenarioId}` },
      `gen-default-${currentScenarioId}`
    );
    const defaultList = [defaultGenerator];
    const defaultSig = stableSerialize(defaultList);
    setGenerators((prev) => (stableSerialize(prev) === defaultSig ? prev : defaultList));
    setActiveGeneratorId((prev) => (prev === defaultGenerator.id ? prev : defaultGenerator.id));
    setCompareGeneratorIds([defaultGenerator.id]);
    setSelectedYear((prev) => (prev === null ? prev : null));
    setSelectedCityKey((prev) => (prev === null ? prev : null));
    setResidentialConsumptionKwhMonth(DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH);
    hydrated.add(currentScenarioId);
  }, [currentScenarioId, rsuByScenario]);

  useEffect(() => {
    if (!generators.length) {
      setCompareGeneratorIds([]);
      return;
    }
    setCompareGeneratorIds((prev) => {
      const valid = prev.filter((id) => generators.some((g) => g.id === id));
      if (valid.length) return valid;
      return generators.slice(0, 3).map((g) => g.id);
    });
  }, [generators]);

  useEffect(() => {
    if (!currentScenarioId || !generators.length) return;
    if (!hydratedEnergyScenariosRef.current.has(currentScenarioId)) return;
    const validCompareGeneratorIds = compareGeneratorIds.filter((id) =>
      generators.some((g) => g.id === id)
    );
    const nextEnergy = {
      generators,
      activeGeneratorId: activeGeneratorId || generators[0].id,
      compareGeneratorIds: validCompareGeneratorIds,
      selectedYear: Number.isFinite(Number(selectedYear)) ? Number(selectedYear) : null,
      selectedCityKey:
        typeof selectedCityKey === "string" && selectedCityKey.trim() ? selectedCityKey : null,
      residentialConsumptionKwhMonth: Math.max(
        1,
        toNumber(residentialConsumptionKwhMonth, DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH)
      ),
    };

    setRsuByScenario((prev) => {
      const safePrev = prev || {};
      const currentEntry = safePrev[currentScenarioId] || {};
      const prevEnergySig = stableSerialize(currentEntry.energy || {});
      const nextEnergySig = stableSerialize(nextEnergy);
      if (
        currentEntry.energy &&
        prevEnergySig === nextEnergySig
      ) {
        return safePrev;
      }

      return {
        ...safePrev,
        [currentScenarioId]: {
          ...currentEntry,
          energy: nextEnergy,
        },
      };
    });
  }, [
    currentScenarioId,
    generators,
    activeGeneratorId,
    compareGeneratorIds,
    selectedYear,
    selectedCityKey,
    residentialConsumptionKwhMonth,
    setRsuByScenario,
  ]);

  const scenarioEntry = useMemo(
    () => (currentScenarioId ? rsuByScenario?.[currentScenarioId] : null),
    [currentScenarioId, rsuByScenario]
  );

  const config = useMemo(() => normalizeConfig(scenarioEntry?.config), [scenarioEntry?.config]);
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

  const annualMethaneData = useMemo(() => {
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

  const activeGenerator = useMemo(
    () => generators.find((g) => g.id === activeGeneratorId) || generators[0] || null,
    [generators, activeGeneratorId]
  );

  const annualEnergyData = useMemo(
    () =>
      annualMethaneData.map((row) => {
        const energy = generatorEnergyFromMethane(row.metanoTAno, activeGenerator);
        return {
          ...row,
          energiaPotencialMwh: energy.energiaPotencialKwh / 1000,
          energiaGeradaMwh: energy.energiaGeradaMwh,
          limiteMwh: energy.limitePorPotenciaKwh / 1000,
        };
      }),
    [annualMethaneData, activeGenerator]
  );

  const cityRowsByKey = useMemo(() => {
    const map = new Map();
    (landfillCalc?.cities || []).forEach((city) => {
      map.set(city.key, city.rows || []);
    });
    return map;
  }, [landfillCalc]);

  const cityEnergyData = useMemo(() => {
    if (!selectedYear) return [];

    return rows
      .map((row) => {
        const key = cityKey(row);
        const cityRows = cityRowsByKey.get(key) || [];
        const selectedRow = cityRows.find((item) => Number(item?.ano) === selectedYear);
        const metanoTAno = Number(selectedRow?.metanoTAno) || 0;
        const energy = generatorEnergyFromMethane(metanoTAno, activeGenerator);

        return {
          key,
          uf: row.uf,
          nome: cityShortName(row.nome),
          populacao: Number(selectedRow?.pop) || 0,
          residuoTAno: Number(selectedRow?.residuoTAno) || 0,
          metanoTAno,
          energiaPotencialMwh: energy.energiaPotencialKwh / 1000,
          energiaGeradaMwh: energy.energiaGeradaMwh,
        };
      })
      .sort((a, b) => b.energiaPotencialMwh - a.energiaPotencialMwh);
  }, [rows, selectedYear, cityRowsByKey, activeGenerator]);

  useEffect(() => {
    if (!cityEnergyData.length) {
      setSelectedCityKey(null);
      return;
    }
    if (!selectedCityKey || !cityEnergyData.some((c) => c.key === selectedCityKey)) {
      setSelectedCityKey(cityEnergyData[0].key);
    }
  }, [cityEnergyData, selectedCityKey]);

  const selectedCity = useMemo(
    () => cityEnergyData.find((c) => c.key === selectedCityKey) || null,
    [cityEnergyData, selectedCityKey]
  );

  const selectedYearTotals = useMemo(
    () => annualEnergyData.find((d) => d.ano === selectedYear) || null,
    [annualEnergyData, selectedYear]
  );

  const annualResidentialConsumptionKwh = useMemo(
    () =>
      Math.max(1, toNumber(residentialConsumptionKwhMonth, DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH)) * 12,
    [residentialConsumptionKwhMonth]
  );

  const comparedGenerators = useMemo(
    () => generators.filter((g) => compareGeneratorIds.includes(g.id)),
    [generators, compareGeneratorIds]
  );

  const generatorComparisonData = useMemo(() => {
    const methaneTAno = selectedYearTotals?.metanoTAno || 0;
    return comparedGenerators.map((generator) => {
      const energy = generatorEnergyFromMethane(methaneTAno, generator);
      const energiaGeradaMwh = energy.energiaGeradaMwh;
      const energiaPotencialMwh = energy.energiaPotencialKwh / 1000;
      const limiteMwh = energy.limitePorPotenciaKwh / 1000;
      const casasAtendidasAno = (energiaPotencialMwh * 1000) / annualResidentialConsumptionKwh;
      const utilizacaoPotenciaPct =
        limiteMwh > 0 ? (energiaGeradaMwh / limiteMwh) * 100 : 0;
      return {
        id: generator.id,
        nome: generator.nome,
        tipo: generator.tipo,
        eficienciaEletricaPct: generator.eficienciaEletricaPct,
        potenciaNominalKw: generator.potenciaNominalKw,
        disponibilidadePct: generator.disponibilidadePct,
        energiaGeradaMwh,
        energiaPotencialMwh,
        casasAtendidasAno,
        limiteMwh,
        utilizacaoPotenciaPct,
      };
    });
  }, [comparedGenerators, selectedYearTotals, annualResidentialConsumptionKwh]);

  const comparisonSeries = useMemo(() => {
    return comparedGenerators.map((generator, idx) => ({
      id: generator.id,
      nome: generator.nome,
      color: ENERGY_SERIES_COLORS[idx % ENERGY_SERIES_COLORS.length],
    }));
  }, [comparedGenerators]);

  const comparisonAreaData = useMemo(
    () =>
      annualMethaneData.map((row) => {
        const point = { ano: row.ano };
        comparedGenerators.forEach((generator) => {
          const energy = generatorEnergyFromMethane(row.metanoTAno, generator);
          point[generator.id] = energy.energiaPotencialKwh / 1000;
        });
        return point;
      }),
    [annualMethaneData, comparedGenerators]
  );

  const comparisonTicks = useMemo(
    () => comparisonAreaData.map((point) => point.ano),
    [comparisonAreaData]
  );

  const comparisonTickInterval = useMemo(() => {
    const total = comparisonTicks.length;
    if (total <= 14) return 0;
    const targetTicks = isMobile ? 8 : 14;
    return Math.max(0, Math.ceil(total / targetTicks) - 1);
  }, [comparisonTicks, isMobile]);

  const homesComparisonData = useMemo(
    () =>
      comparisonAreaData.map((row) => {
        const point = { ano: row.ano };
        comparisonSeries.forEach((series) => {
          const energiaMwh = Number(row?.[series.id]) || 0;
          point[series.id] = (energiaMwh * 1000) / annualResidentialConsumptionKwh;
        });
        return point;
      }),
    [comparisonAreaData, comparisonSeries, annualResidentialConsumptionKwh]
  );

  const annualHomesData = useMemo(
    () =>
      annualEnergyData.map((row) => ({
        ...row,
        casasAtendidas:
          (Number(row?.energiaPotencialMwh) || 0) * 1000 / annualResidentialConsumptionKwh,
      })),
    [annualEnergyData, annualResidentialConsumptionKwh]
  );

  const homesSeries = useMemo(() => {
    if (comparisonSeries.length) return comparisonSeries;
    return [
      {
        id: "casasAtendidas",
        nome: activeGenerator?.nome
          ? `Casas (${activeGenerator.nome})`
          : "Casas alimentadas",
        color: "#2e7d32",
      },
    ];
  }, [comparisonSeries, activeGenerator]);

  const hasComparedHomesSeries = comparisonSeries.length > 0;

  const homesChartData = useMemo(() => {
    if (hasComparedHomesSeries) return homesComparisonData;
    return annualHomesData.map((row) => ({ ano: row.ano, casasAtendidas: row.casasAtendidas }));
  }, [hasComparedHomesSeries, homesComparisonData, annualHomesData]);

  const selectedYearHomes = useMemo(
    () => annualHomesData.find((d) => d.ano === selectedYear) || null,
    [annualHomesData, selectedYear]
  );

  const homesTicks = useMemo(() => homesChartData.map((point) => point.ano), [homesChartData]);
  const homesTickInterval = useMemo(() => {
    const total = homesTicks.length;
    if (total <= 14) return 0;
    const targetTicks = isMobile ? 8 : 14;
    return Math.max(0, Math.ceil(total / targetTicks) - 1);
  }, [homesTicks, isMobile]);

  const cityAxisWidth = useMemo(() => {
    const maxChars = cityEnergyData.reduce((maxLen, row) => Math.max(maxLen, row.nome.length), 0);
    const estimated = Math.round(maxChars * (isMobile ? 5.5 : 6.2));
    const min = isMobile ? 84 : 100;
    const max = isMobile ? 112 : 170;
    return Math.min(max, Math.max(min, estimated));
  }, [cityEnergyData, isMobile]);

  const formatCityTick = (value) => {
    const text = String(value ?? "");
    const max = isMobile ? 12 : 22;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const handleAddTemplate = (templateId) => {
    const template = GENERATOR_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const next = createGeneratorFromTemplate(template);
    setGenerators((prev) => [...prev, next]);
    setActiveGeneratorId(next.id);
  };

  const handleAddCustomGenerator = () => {
    const nome = customDraft.nome.trim();
    const tipo = customDraft.tipo.trim();
    if (!nome || !tipo) return;

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = normalizeGenerator(
      {
        id: `gen-custom-${stamp}`,
        nome,
        tipo,
        eficienciaEletricaPct: customDraft.eficienciaEletricaPct,
        potenciaNominalKw: customDraft.potenciaNominalKw,
        disponibilidadePct: customDraft.disponibilidadePct,
        energiaEspecificaKwhPorTonCh4: customDraft.energiaEspecificaKwhPorTonCh4,
      },
      `gen-custom-${stamp}`
    );
    setGenerators((prev) => [...prev, next]);
    setActiveGeneratorId(next.id);
  };

  const handleRemoveGenerator = (id) => {
    setGenerators((prev) => {
      const filtered = prev.filter((g) => g.id !== id);
      if (!filtered.length) return prev;
      if (activeGeneratorId === id) {
        setActiveGeneratorId(filtered[0].id);
      }
      return filtered;
    });
    setCompareGeneratorIds((prev) => prev.filter((gid) => gid !== id));
  };

  const toggleCompareGenerator = (id) => {
    setCompareGeneratorIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((gid) => gid !== id);
      }
      return [...prev, id];
    });
  };

  if (loadingUser) {
    return (
      <div className={`home-container ${loaded ? "fade-in" : ""}`}>
        <p>Carregando dados do usuario...</p>
      </div>
    );
  }

  return (
    <div className={`home-container ${loaded ? "fade-in" : ""}`}>
      <header className="home-header">
        <div>
          <h1>Energia Eletrica</h1>
          <p>Estimativa de geracao eletrica a partir do metano do cenário selecionado.</p>
        </div>

        <div className="header-actions">
          <div className="select-wrap compact energy-year-select">
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

      <section className="card glow energy-generator-card">
        <div className="energy-generator-header">
          <h3>Tipos de Geradores</h3>
          <p>Adicione presets ou cadastre um gerador personalizado com entradas comuns.</p>
        </div>

        <div className="energy-template-row">
          {GENERATOR_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="btn-secondary"
              onClick={() => handleAddTemplate(template.id)}
            >
              + {template.nome}
            </button>
          ))}
        </div>

        <div className="energy-generator-form">
          <div className="field">
            <label>Nome do gerador</label>
            <input
              type="text"
              value={customDraft.nome}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, nome: e.target.value }))}
              placeholder="Ex.: Meu Gerador 01"
            />
          </div>

          <div className="field">
            <label>Tipo do gerador</label>
            <input
              type="text"
              value={customDraft.tipo}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, tipo: e.target.value }))}
              placeholder="Ex.: Motor, Peltier, Turbina..."
            />
          </div>

          <div className="field">
            <label>Eficiencia eletrica (%)</label>
            <input
              type="number"
              value={customDraft.eficienciaEletricaPct}
              onChange={(e) =>
                setCustomDraft((prev) => ({ ...prev, eficienciaEletricaPct: e.target.value }))
              }
            />
          </div>

          <div className="field">
            <label>Potencia nominal (kW)</label>
            <input
              type="number"
              value={customDraft.potenciaNominalKw}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, potenciaNominalKw: e.target.value }))}
            />
          </div>

          <div className="field">
            <label>Disponibilidade (%)</label>
            <input
              type="number"
              value={customDraft.disponibilidadePct}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, disponibilidadePct: e.target.value }))}
            />
          </div>

          <div className="field">
            <label>Energia especifica do CH4 (kWh/t)</label>
            <input
              type="number"
              value={customDraft.energiaEspecificaKwhPorTonCh4}
              onChange={(e) =>
                setCustomDraft((prev) => ({
                  ...prev,
                  energiaEspecificaKwhPorTonCh4: e.target.value,
                }))
              }
            />
          </div>
        </div>

        <div className="energy-generator-actions">
          <button className="btn-primary" type="button" onClick={handleAddCustomGenerator}>
            Adicionar gerador personalizado
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setCompareGeneratorIds(generators.map((g) => g.id))}
          >
            Comparar todos
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setCompareGeneratorIds(activeGeneratorId ? [activeGeneratorId] : [])}
          >
            Manter apenas ativo
          </button>
        </div>

        <div className="energy-generator-list-wrap">
          <table className="energy-generator-list">
            <thead>
              <tr>
                <th>Ativo</th>
                <th>Comparar</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Efic (%)</th>
                <th>Pot. (kW)</th>
                <th>Disp. (%)</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {generators.map((g) => (
                <tr key={g.id} className={g.id === activeGeneratorId ? "is-selected" : ""}>
                  <td>
                    <input
                      type="radio"
                      name="active-generator"
                      checked={g.id === activeGeneratorId}
                      onChange={() => setActiveGeneratorId(g.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={compareGeneratorIds.includes(g.id)}
                      onChange={() => toggleCompareGenerator(g.id)}
                    />
                  </td>
                  <td>{g.nome}</td>
                  <td>{g.tipo}</td>
                  <td>{fmtTon(g.eficienciaEletricaPct)}</td>
                  <td>{fmtTon(g.potenciaNominalKw)}</td>
                  <td>{fmtTon(g.disponibilidadePct)}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleRemoveGenerator(g.id)}
                      disabled={generators.length <= 1}
                      title={generators.length <= 1 ? "Mantenha pelo menos um gerador" : "Remover gerador"}
                    >
                      <span className="material-icons">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card glow energy-compare-card">
        <div className="energy-generator-header">
          <h3>Comparativo de Geradores ({selectedYear || "-"})</h3>
          <p>
            Curva anual baseada no potencial energético do metano para os geradores selecionados.
            Consumo usado: {fmtInt(annualResidentialConsumptionKwh)} kWh/ano por residência.
          </p>
        </div>

        {generatorComparisonData.length === 0 ? (
          <div className="energy-compare-empty">
            Selecione pelo menos um gerador na coluna "Comparar".
          </div>
        ) : (
          <>
            <div className="energy-compare-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={comparisonAreaData}
                  margin={
                    isMobile
                      ? { top: 10, right: 10, left: 0, bottom: 18 }
                      : { top: 12, right: 18, left: 6, bottom: 12 }
                  }
                >
                  <defs>
                    {comparisonSeries.map((series) => (
                      <linearGradient key={series.id} id={`compare-${series.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={series.color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={series.color} stopOpacity={0.06} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#dfe9e3" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="ano"
                    tickMargin={8}
                    interval={comparisonTickInterval}
                    ticks={comparisonTicks}
                    tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                    tickLine={{ stroke: "#dfe9e3" }}
                    axisLine={{ stroke: "#dfe9e3" }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    width={isMobile ? 70 : 90}
                    tickFormatter={(v) => fmtMwh(v)}
                    tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                    tickLine={{ stroke: "#dfe9e3" }}
                    axisLine={{ stroke: "#dfe9e3" }}
                  />
                  <Legend />
                  <ReTooltip
                    formatter={(value, name) => {
                      const casas = (Number(value) * 1000) / annualResidentialConsumptionKwh;
                      return [`${fmtMwh(value)} MWh • ${fmtInt(casas)} casas/ano`, name];
                    }}
                    labelFormatter={(label) => `Ano ${label}`}
                    contentStyle={{
                      background: "#fff",
                      border: "1px solid #1b5e20",
                      borderRadius: 8,
                      color: "#1b5e20",
                      fontWeight: 700,
                    }}
                  />
                  {comparisonSeries.map((series) => (
                    <Area
                      key={series.id}
                      type="linear"
                      dataKey={series.id}
                      name={series.nome}
                      stroke={series.color}
                      fill={`url(#compare-${series.id})`}
                      fillOpacity={1}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="energy-compare-table-wrap">
              <table className="energy-compare-table">
                <thead>
                  <tr>
                    <th>Gerador</th>
                    <th>Tipo</th>
                    <th>Efic. (%)</th>
                    <th>Pot. (kW)</th>
                    <th>Disp. (%)</th>
                    <th>Energia gerada (MWh)</th>
                    <th>Energia potencial (MWh)</th>
                    <th>Casas/ano</th>
                    <th>Uso da potência (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {generatorComparisonData.map((row) => (
                    <tr key={row.id}>
                      <td>{row.nome}</td>
                      <td>{row.tipo}</td>
                      <td>{fmtTon(row.eficienciaEletricaPct)}</td>
                      <td>{fmtTon(row.potenciaNominalKw)}</td>
                      <td>{fmtTon(row.disponibilidadePct)}</td>
                      <td>{fmtMwh(row.energiaGeradaMwh)}</td>
                      <td>{fmtMwh(row.energiaPotencialMwh)}</td>
                      <td>{fmtInt(row.casasAtendidasAno)}</td>
                      <td>{fmtTon(row.utilizacaoPotenciaPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {!rows.length ? (
        <section className="card glow energy-empty">
          <h3>Sem cidades no cenário selecionado</h3>
          <p>Adicione cidades na página inicial para visualizar a geração de energia.</p>
        </section>
      ) : (
        <>
          <div className="exp-metrics-row energy-metrics-row">
            <div className="exp-metric-card glow">
              <h3>Geradores cadastrados</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">precision_manufacturing</span>
                <div className="exp-text">
                  <h2>{generators.length}</h2>
                </div>
              </div>
            </div>

            <div className="exp-metric-card glow">
              <h3>Potencial total ({selectedYear})</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">bolt</span>
                <div className="exp-text">
                  <h2>{fmtMwh(selectedYearTotals?.energiaPotencialMwh || 0)} MWh</h2>
                  <p className="green-text">Gerada: {fmtMwh(selectedYearTotals?.energiaGeradaMwh || 0)} MWh</p>
                </div>
              </div>
            </div>

            <div className="exp-metric-card glow">
              <h3>Gerador ativo</h3>
              <div className="exp-mini-content">
                <span className="material-icons exp-icon">tune</span>
                <div className="exp-text">
                  <p className="green-text">{activeGenerator?.nome || "Sem gerador"}</p>
                  <h2>{fmtTon(activeGenerator?.potenciaNominalKw || 0)} kW</h2>
                </div>
              </div>
            </div>
          </div>

          <main className="home-grid energy-grid">
            <section className="card glow energy-map-card energy-map-main-card">
              <div className="map-card-header">
                <h3>Mapa Interativo de Energia por Cidade</h3>
              </div>

              <div className="energy-map-layout">
                <EnergyMap rows={rows} selectedCityKey={selectedCityKey} onSelectCity={setSelectedCityKey} />

                <aside className="energy-city-info">
                  <h4>Cidade selecionada</h4>
                  {!selectedCity ? (
                    <p>Clique em uma cidade no mapa para ver os indicadores.</p>
                  ) : (
                    <div className="energy-city-info-content">
                      <p className="energy-city-name">
                        {selectedCity.nome} ({selectedCity.uf})
                      </p>
                      <div className="energy-city-stat">
                        <span>Populacao ({selectedYear})</span>
                        <strong>{fmtInt(selectedCity.populacao)}</strong>
                      </div>
                      <div className="energy-city-stat">
                        <span>Producao de metano</span>
                        <strong>{fmtTon(selectedCity.metanoTAno)} t/ano</strong>
                      </div>
                      <div className="energy-city-stat">
                        <span>Potencial elétrico (metano)</span>
                        <strong>{fmtMwh(selectedCity.energiaPotencialMwh)} MWh/ano</strong>
                      </div>
                      <div className="energy-city-stat">
                        <span>Geração limitada por potência</span>
                        <strong>{fmtMwh(selectedCity.energiaGeradaMwh)} MWh/ano</strong>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </section>

            <section className="card glow energy-city-card">
              <h3>Potencial por Cidade ({selectedYear})</h3>
              <div className="energy-city-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={cityEnergyData}
                    margin={
                      isMobile
                        ? { top: 8, right: 8, left: 6, bottom: 8 }
                        : { top: 8, right: 18, left: 8, bottom: 8 }
                    }
                    barCategoryGap={8}
                  >
                    <CartesianGrid stroke="#edf3ee" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => fmtMwh(v)}
                      tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                      tickLine={{ stroke: "#dfe9e3" }}
                      axisLine={{ stroke: "#dfe9e3" }}
                      domain={[0, "auto"]}
                    />
                    <YAxis
                      type="category"
                      dataKey="nome"
                      width={cityAxisWidth}
                      interval={0}
                      tickFormatter={formatCityTick}
                      tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                      tickLine={{ stroke: "#dfe9e3" }}
                      axisLine={{ stroke: "#dfe9e3" }}
                    />
                    <ReTooltip
                      formatter={(value) => [`${fmtMwh(value)} MWh`, "Potencial"]}
                      labelFormatter={(value) => `Cidade: ${value}`}
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #1b5e20",
                        borderRadius: 8,
                        color: "#1b5e20",
                        fontWeight: 700,
                      }}
                    />
                    <Bar
                      dataKey="energiaPotencialMwh"
                      radius={[0, 8, 8, 0]}
                      onClick={(entry) => setSelectedCityKey(entry?.payload?.key || null)}
                    >
                      {cityEnergyData.map((c) => (
                        <Cell key={c.key} fill={c.key === selectedCityKey ? "#ef6c00" : "#2e7d32"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="card glow energy-homes-input-card">
              <h3>Consumo Residencial</h3>
              <p className="energy-homes-help">
                Informe o consumo mensal médio de uma residência (kWh/mês).
              </p>
              <div className="field">
                <label>Consumo da residência (kWh/mês)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={residentialConsumptionKwhMonth}
                  onChange={(e) =>
                    setResidentialConsumptionKwhMonth(
                      Math.max(1, toNumber(e.target.value, DEFAULT_RESIDENTIAL_CONSUMPTION_KWH_MONTH))
                    )
                  }
                />
              </div>

              <div className="energy-home-summary">
                <span>Casas alimentadas em {selectedYear} (gerador ativo)</span>
                <strong>{fmtInt(selectedYearHomes?.casasAtendidas || 0)}</strong>
              </div>
            </section>

            <section className="card glow energy-homes-chart-card">
              <h3>Casas Alimentadas pelo Gerador (por ano)</h3>
              <p className="energy-homes-help">
                Estimativa baseada no potencial energético anual dos geradores selecionados no comparador.
              </p>
              <div className="energy-homes-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={homesChartData}
                    margin={
                      isMobile
                        ? { top: 12, right: 10, bottom: 22, left: 0 }
                        : { top: 12, right: 18, bottom: 12, left: 6 }
                    }
                  >
                    <defs>
                      {homesSeries.map((series) => (
                        <linearGradient key={series.id} id={`homes-${series.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={series.color} stopOpacity={0.32} />
                          <stop offset="100%" stopColor={series.color} stopOpacity={0.06} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="#dfe9e3" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="ano"
                      tickMargin={8}
                      interval={homesTickInterval}
                      ticks={homesTicks}
                      tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                      tickLine={{ stroke: "#dfe9e3" }}
                      axisLine={{ stroke: "#dfe9e3" }}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtInt(v)}
                      width={isMobile ? 70 : 90}
                      tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                      tickLine={{ stroke: "#dfe9e3" }}
                      axisLine={{ stroke: "#dfe9e3" }}
                      domain={[0, "auto"]}
                    />
                    <Legend />
                    <ReTooltip
                      formatter={(value, name) => [`${fmtInt(value)} casas/ano`, name]}
                      labelFormatter={(label) => `Ano ${label}`}
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #1b5e20",
                        borderRadius: 8,
                        color: "#1b5e20",
                        fontWeight: 700,
                      }}
                    />
                    {homesSeries.map((series) => (
                      <Area
                        key={series.id}
                        type="linear"
                        dataKey={series.id}
                        name={series.nome}
                        stroke={series.color}
                        strokeWidth={2.4}
                        fill={`url(#homes-${series.id})`}
                        fillOpacity={1}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </main>
        </>
      )}
    </div>
  );
}
