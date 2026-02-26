import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/Home.css";
import { ResponsivePie } from "@nivo/pie";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line as ReLine,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
} from "recharts";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useDashboard } from "../context/DashboardContext.jsx";

/* =========================================================
   Config APIs
========================================================= */
const API_BASE =
  (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "/backend" : "");
const ESTADOS_API = `${API_BASE}/api/json/estados_municipios.json`; // lista de UFs e municípios
const POP_BASE_API = `${API_BASE}/api/json`; // UF_populacao_2000_2060.json

/* =========================================================
   Ícones/coords para marcadores (opcional)
========================================================= */
const greenIcon = new L.Icon({
  iconUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const COORDS = {
  "Campina Grande (PB)": [-7.2307, -35.8817],
  "Queimadas (PB)": [-7.3583, -35.8975],
  "Lagoa Seca (PB)": [-7.1556, -35.8533],
  "Boqueirão (PB)": [-7.4832, -36.1306],
  "Puxinanã (PB)": [-7.1489, -35.9587],
  "Massaranduba (PB)": [-7.1893, -35.7844],
  "Umbuzeiro (PB)": [-7.6919, -35.6583],
  "Fagundes (PB)": [-7.3553, -35.7753],
};
const EMPTY_ROWS = [];

function toPopNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1_000_000_000, Math.max(0, num));
}

function useMarkers(rows) {
  return useMemo(
    () =>
      rows
        .map((r) => {
          const coords = COORDS[r.nome];
          if (!coords) return null;
          return {
            id: `${r.uf}-${r.nome}`,
            nome: r.nome.replace(/\s*\([A-Z]{2}\)\s*$/, ""),
            uf: r.uf,
            position: coords,
          };
        })
        .filter(Boolean),
    [rows]
  );
}

/* =========================================================
   Utils IBGE (Localidades + Malhas v3)
========================================================= */
const IBGE_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades";
const IBGE_MALHAS_V3 = "https://servicodados.ibge.gov.br/api/v3/malhas";

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
  const list = await fetch(
    `${IBGE_LOCALIDADES}/estados/${ufSigla}/municipios`
  ).then((r) => r.json());
  const alvo = norm(nomeMunicipio);
  const hit =
    list.find((m) => norm(m.nome) === alvo) ||
    list.find((m) => norm(m.nome).startsWith(alvo)) ||
    list.find((m) => alvo.startsWith(norm(m.nome))) ||
    list.find((m) => norm(m.nome).includes(alvo) || alvo.includes(norm(m.nome)));
  if (!hit)
    throw new Error(`Município não encontrado: ${nomeMunicipio}/${ufSigla}`);
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
      const resp = await fetch(url, {
        headers: { Accept: "application/vnd.geo+json" },
      });
      if (!resp.ok) throw new Error(`IBGE malha HTTP ${resp.status}`);

      const gj = await resp.json();
      if (gj.type === "FeatureCollection") return gj;
      if (gj.type === "Feature") {
        return { type: "FeatureCollection", features: [gj] };
      }
      throw new Error("GeoJSON inesperado da malha do IBGE");
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Falha ao carregar malha do IBGE");
}

/* =========================================================
   MAPA — Várias áreas (todas as cidades da tabela) + Fullscreen
========================================================= */
function MapCard({ rows, focusKey, onFocusDone }) {
  const markers = useMarkers(rows);
  const mapRef = useRef(null);
  const wrapRef = useRef(null);
  const focusFetchRef = useRef(new Set());
  const [mapReady, setMapReady] = useState(false);

  const [geoCache, setGeoCache] = useState(() => new Map());
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [errorKeys, setErrorKeys] = useState(new Map());
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const wantedKeys = rows.map((r) => `${r.uf}::${r.nome}`);
    const missing = wantedKeys.filter(
      (k) => !geoCache.has(k) && !loadingKeys.has(k)
    );
    if (missing.length === 0) return;

    setLoadingKeys((prev) => new Set([...prev, ...missing]));
    (async () => {
      const newCache = new Map(geoCache);
      const newErrors = new Map(errorKeys);
      await Promise.all(
        missing.map(async (key) => {
          const [uf, nome] = key.split("::");
          try {
            const id = await getMunicipioId(uf, nome);
            const gj = await getMunicipioGeoJSON(id, "intermediaria");
            newCache.set(key, gj);
            newErrors.delete(key);
          } catch (e) {
            newErrors.set(key, e?.message ?? "Erro ao baixar malha");
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
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    if (focusKey) return;

    const allFeatures = [];
    geoCache.forEach((fc, key) => {
      const inRows = rows.some((r) => `${r.uf}::${r.nome}` === key);
      if (inRows && fc?.features?.length) allFeatures.push(...fc.features);
    });

    if (allFeatures.length > 0) {
      const g = L.geoJSON({ type: "FeatureCollection", features: allFeatures });
      const b = g.getBounds();
      if (b.isValid()) {
        map.fitBounds(b.pad(0.12));
        return;
      }
    }

    if (markers.length) {
      const group = L.featureGroup(markers.map((m) => L.marker(m.position)));
      const b = group.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [30, 30] });
        return;
      }
    }

    map.setView([-14.235, -51.9253], 4);
  }, [geoCache, rows, markers, focusKey, mapReady]);

  useEffect(() => {
    if (!focusKey) return;
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const zoomToFeature = (fc) => {
      if (!fc?.features?.length) return false;
      const g = L.geoJSON(fc);
      const b = g.getBounds();
      if (!b.isValid()) return false;
      map.flyToBounds(b.pad(0.2), { duration: 1.2 });
      return true;
    };

    const fc = geoCache.get(focusKey);
    if (zoomToFeature(fc)) {
      onFocusDone?.();
      return;
    }

    const row = rows.find((r) => `${r.uf}::${r.nome}` === focusKey);
    const coords = row ? COORDS[row.nome] : null;
    if (coords) {
      map.flyTo(coords, 9, { duration: 1.2 });
      onFocusDone?.();
      return;
    }

    if (loadingKeys.has(focusKey) || focusFetchRef.current.has(focusKey)) return;

    const [uf, nome] = String(focusKey).split("::");
    if (!uf || !nome) {
      onFocusDone?.();
      return;
    }

    focusFetchRef.current.add(focusKey);
    setLoadingKeys((prev) => new Set([...prev, focusKey]));
    let cancelled = false;

    (async () => {
      try {
        const id = await getMunicipioId(uf, nome);
        const gj = await getMunicipioGeoJSON(id, "intermediaria");
        if (cancelled) return;

        setGeoCache((prev) => {
          const next = new Map(prev);
          next.set(focusKey, gj);
          return next;
        });
        setErrorKeys((prev) => {
          const next = new Map(prev);
          next.delete(focusKey);
          return next;
        });
        zoomToFeature(gj);
      } catch (e) {
        if (cancelled) return;
        setErrorKeys((prev) => {
          const next = new Map(prev);
          next.set(focusKey, e?.message ?? "Erro ao baixar malha");
          return next;
        });
      } finally {
        focusFetchRef.current.delete(focusKey);
        if (!cancelled) {
          setLoadingKeys((prev) => {
            const next = new Set(prev);
            next.delete(focusKey);
            return next;
          });
          onFocusDone?.();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusKey, geoCache, rows, loadingKeys, onFocusDone, mapReady]);

  const palette = [
    "#1b5e20",
    "#2e7d32",
    "#43a047",
    "#66bb6a",
    "#81c784",
    "#a5d6a7",
  ];
  const styleForKey = (idx) => {
    const c = palette[idx % palette.length];
    return { color: c, weight: 2.5, fillColor: c, fillOpacity: 0.25 };
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tick = () => map.invalidateSize(true);
    const t = setTimeout(tick, 0);
    const t2 = setTimeout(tick, 150);
    const t3 = setTimeout(tick, 300);
    window.addEventListener("resize", tick);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", tick);
    };
  }, [isFull]);

  useEffect(() => {
    const map = mapRef.current;
    const el = wrapRef.current;
    if (!map || !el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => map.invalidateSize());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const cls = "no-scroll";
    if (isFull) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [isFull]);

  return (
    <div className={`exp-map-card glow ${isFull ? "is-fullscreen" : ""}`}>
      <div className="map-card-header">
        <h3>Mapa</h3>
        <button
          className="btn-secondary map-full-btn"
          onClick={() => setIsFull((v) => !v)}
          title={isFull ? "Sair da tela cheia" : "Tela cheia"}
        >
          <span
            className="material-icons"
            style={{ fontSize: 18, marginRight: 6 }}
          >
            {isFull ? "fullscreen_exit" : "fullscreen"}
          </span>
          {isFull ? "Sair" : "Expandir"}
        </button>
      </div>

      <div ref={wrapRef} className={`map-wrap ${isFull ? "fullscreen" : ""}`}>
        <MapContainer
          key={isFull ? "map-full" : "map-normal"}
          whenCreated={(map) => {
            mapRef.current = map;
            setMapReady(true);
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

          {rows.map((r, i) => {
            const key = `${r.uf}::${r.nome}`;
            const fc = geoCache.get(key);
            if (!fc) return null;
            return <GeoJSON key={key} data={fc} style={styleForKey(i)} />;
          })}

          {markers.map((m) => (
            <Marker key={m.id} position={m.position} icon={greenIcon}>
              <Popup>
                <strong>{m.nome}</strong> – {m.uf}
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {loadingKeys.size > 0 && (
          <div className="map-loading">Carregando {loadingKeys.size} área(s)…</div>
        )}
        {Array.from(errorKeys.values()).length > 0 && (
          <div className="map-error">Algumas áreas não carregaram (IBGE).</div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   Página
========================================================= */
export default function Home() {
  const [loaded, setLoaded] = useState(false);
  const [focusKey, setFocusKey] = useState(null);
  const { loadingUser, scenarios, setScenarios, currentScenarioId } = useDashboard();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  // seleção de filtros
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [anoIni, setAnoIni] = useState(2000);
  const [anoFin, setAnoFin] = useState(2060);

  // estados/municípios vindos da API
  const [estadosData, setEstadosData] = useState([]);
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [errorOpts, setErrorOpts] = useState(null);

  // cache com dados de população por UF (AP, PB, etc.)
  const [seriesCache, setSeriesCache] = useState(() => new Map());
  const [adding, setAdding] = useState(false);
  const [errorAdd, setErrorAdd] = useState(null);
  const localScenarioIdRef = useRef(null);
  const pendingScenarioHydrationRef = useRef(null);

  // tabela começa vazia
  const [rows, setRows] = useState([]);

  // efeito visual da página
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // carrega estados/municípios da API ao montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingOpts(true);
        const resp = await fetch(ESTADOS_API);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!cancelled) {
          setEstadosData(json);
          setErrorOpts(null);
        }
      } catch (e) {
        if (!cancelled)
          setErrorOpts(e?.message ?? "Erro ao carregar estados/municípios");
      } finally {
        if (!cancelled) setLoadingOpts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // sincroniza o cenário selecionado na navbar com os dados locais da Home
  useEffect(() => {
    if (!currentScenarioId) {
      setRows([]);
      setAnoIni(2000);
      setAnoFin(2060);
      localScenarioIdRef.current = null;
      pendingScenarioHydrationRef.current = null;
      return;
    }
    const selected = scenarios.find(
      (s) => String(s.id) === String(currentScenarioId)
    );
    if (!selected) return;

    const nextRows = Array.isArray(selected.rows) ? selected.rows : EMPTY_ROWS;
    const nextAnoIni = selected.anoInicial ?? 2000;
    const nextAnoFin = selected.anoFinal ?? 2060;

    setRows((prev) => (prev === nextRows ? prev : nextRows));
    setAnoIni((prev) => (prev === nextAnoIni ? prev : nextAnoIni));
    setAnoFin((prev) => (prev === nextAnoFin ? prev : nextAnoFin));
    localScenarioIdRef.current = currentScenarioId;
    pendingScenarioHydrationRef.current = currentScenarioId;
  }, [currentScenarioId, scenarios]);

  // sempre que rows/anos mudarem, sincroniza com o cenário atual
  useEffect(() => {
    if (!currentScenarioId) return;
    if (localScenarioIdRef.current !== currentScenarioId) return;
    if (pendingScenarioHydrationRef.current === currentScenarioId) {
      pendingScenarioHydrationRef.current = null;
      return;
    }
    setScenarios((prev) =>
      {
        let changed = false;
        const next = prev.map((s) => {
          if (String(s.id) !== String(currentScenarioId)) return s;
          if (s.rows === rows && s.anoInicial === anoIni && s.anoFinal === anoFin) {
            return s;
          }
          changed = true;
          return {
            ...s,
            rows,
            anoInicial: anoIni,
            anoFinal: anoFin,
          };
        });
        return changed ? next : prev;
      }
    );
  }, [rows, anoIni, anoFin, currentScenarioId, setScenarios]);

  const ufOptions = useMemo(
    () => estadosData.map((e) => e.Estado),
    [estadosData]
  );

  const municipiosOptions = useMemo(() => {
    const entry = estadosData.find((e) => e.Estado === uf);
    return entry ? entry.municipios : [];
  }, [estadosData, uf]);

  // ==== Adicionar cidade com série de população vinda da API ====
  const handleAdd = async () => {
    if (!uf || !municipio) return;

    const nomeCompleto = `${municipio} (${uf})`;

    // evita duplicar linha
    if (rows.some((r) => r.uf === uf && r.nome === nomeCompleto)) return;

    setAdding(true);
    setErrorAdd(null);

    try {
      // 1) Garante que temos o JSON de população para a UF selecionada
      let estadoData = seriesCache.get(uf);
      if (!estadoData) {
        const url = `${POP_BASE_API}/${uf}_populacao_2000_2060.json`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Erro HTTP ${resp.status} ao carregar ${url}`);
        }
        estadoData = await resp.json();

        // salva no cache para não baixar de novo depois
        setSeriesCache((prev) => {
          const m = new Map(prev);
          m.set(uf, estadoData);
          return m;
        });
      }

      // 2) Procura a cidade dentro desse JSON
      const cidadeEntry = estadoData.find(
        (c) =>
          c["Nome da cidade"] === municipio ||
          c["Nome da cidade"] === nomeCompleto ||
          c["Nome da cidade"] === municipio.replace(` (${uf})`, "")
      );

      if (!cidadeEntry) {
        throw new Error(
          `Cidade "${municipio}" não encontrada em ${uf}_populacao_2000_2060.json`
        );
      }

      // 3) Monta o objeto series: { 2000: 7210, 2001: 7311, ... }
      const series = {};
      for (const h of cidadeEntry.historico || []) {
        series[h.ano] = toPopNumber(h["população"]);
      }

      // 4) Adiciona a linha na tabela (e consequentemente gráficos/mapa)
      setRows((prev) => [{ uf, nome: nomeCompleto, series }, ...prev]);
      setFocusKey(`${uf}::${nomeCompleto}`);

      // QoL: limpa município após adicionar
      setMunicipio("");
    } catch (e) {
      console.error(e);
      setErrorAdd(e?.message ?? "Erro ao adicionar cidade");
    } finally {
      setAdding(false);
    }
  };

  const qtdCidades = rows.length;

  const crescimentoPerc = useMemo(() => {
    if (rows.length === 0) return 0;
    let totIni = 0,
      totFin = 0;
    for (const r of rows) {
      totIni += toPopNumber(r.series?.[anoIni]);
      totFin += toPopNumber(r.series?.[anoFin]);
    }
    return totIni === 0 ? 0 : (totFin / totIni - 1) * 100;
  }, [rows, anoIni, anoFin]);

  const totalPopFin = useMemo(
    () =>
      rows.reduce((acc, r) => acc + toPopNumber(r.series?.[anoFin]), 0),
    [rows, anoFin]
  );

  const pieData = useMemo(() => {
    const totalFin = rows.reduce(
      (acc, r) => acc + toPopNumber(r.series?.[anoFin]),
      0
    );
    if (totalFin === 0) return [];
    const palette = [
      "#1b5e20",
      "#2e7d32",
      "#43a047",
      "#66bb6a",
      "#81c784",
      "#a5d6a7",
      "#c8e6c9",
      "#e8f5e9",
    ];
    return rows.map((r, i) => ({
      id: r.nome.replace(/\s*\([A-Z]{2}\)\s*$/, ""),
      value: Number(
        ((toPopNumber(r.series?.[anoFin]) / totalFin) * 100).toFixed(2)
      ),
      color: palette[i % palette.length],
    }));
  }, [rows, anoFin]);

  /* ======= Série da linha: soma total por ano no intervalo ======= */
  const lineData = useMemo(() => {
    const a = Math.min(anoIni, anoFin);
    const b = Math.max(anoIni, anoFin);
    const out = [];
    for (let y = a; y <= b; y++) {
      let total = 0;
      for (const r of rows) total += toPopNumber(r.series?.[y]);
      out.push({ year: y, total });
    }
    return out;
  }, [rows, anoIni, anoFin]);

  const lineTickValues = useMemo(
    () => lineData.map((point) => point.year),
    [lineData]
  );

  // enquanto ainda está carregando info do usuário, mostra só loading
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
          <h1>Estimativa Populacional</h1>
          <p>Selecione cidades e acompanhe a projeção anual da população por cenário.</p>
        </div>
      </header>

      {/* ===== Card principal ===== */}
      <div className="card glow expectancy-card two-col">
        <div className="expectancy-layout">
          <div className="exp-left">
            <div className="exp-field">
              <label>UF</label>
              <div className="select-wrap">
                <select
                  value={uf}
                  onChange={(e) => {
                    setUf(e.target.value);
                    setMunicipio("");
                  }}
                  disabled={loadingOpts || !!errorOpts}
                >
                  <option value="">Selecione a UF</option>
                  {ufOptions.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
              {loadingOpts && <small>Carregando estados…</small>}
              {errorOpts && (
                <small className="error-text">{errorOpts}</small>
              )}
            </div>

            <div className="exp-field">
              <label>Município</label>
              <div className="select-wrap">
                <select
                  value={municipio}
                  onChange={(e) => setMunicipio(e.target.value)}
                  disabled={!uf || municipiosOptions.length === 0}
                >
                  <option value="">Selecione o município</option>
                  {municipiosOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
            </div>

            <div className="exp-field">
              <label>Ano Inicial</label>
              <div className="select-wrap">
                <select
                  value={anoIni}
                  onChange={(e) => setAnoIni(+e.target.value)}
                >
                  {Array.from({ length: 61 }, (_, i) => 2000 + i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
            </div>

            <div className="exp-field">
              <label>Ano Final</label>
              <div className="select-wrap">
                <select
                  value={anoFin}
                  onChange={(e) => setAnoFin(+e.target.value)}
                >
                  {Array.from({ length: 61 }, (_, i) => 2000 + i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
            </div>

            <div className="exp-actions">
              <button
                className="btn-primary"
                onClick={handleAdd}
                disabled={!uf || !municipio || adding}
                title={
                  !uf || !municipio
                    ? "Selecione UF e município"
                    : adding
                    ? "Carregando dados da população…"
                    : "Adicionar cidade"
                }
              >
                <span
                  className="material-icons"
                  style={{ marginRight: 6, fontSize: 18 }}
                >
                  {adding ? "hourglass_top" : "add"}
                </span>
                {adding ? "Adicionando..." : "Adicionar"}
              </button>

              <RemoveButton
                onRemove={(indexes) => {
                  setRows((prev) => prev.filter((_, i) => !indexes.has(i)));
                }}
              />
            </div>

            {errorAdd && (
              <small className="error-text" style={{ marginTop: 4 }}>
                {errorAdd}
              </small>
            )}
          </div>

          <div className="exp-right">
            <ExpTable rows={rows} anoIni={anoIni} anoFin={anoFin} />
          </div>
        </div>
      </div>

      {/* ===== Mapa ===== */}
      <MapCard rows={rows} focusKey={focusKey} onFocusDone={() => setFocusKey(null)} />

      {/* ===== Métricas logo abaixo do mapa ===== */}
      <div className="exp-metrics-row">
        <div className="exp-metric-card glow">
          <h3>Quantidade de Cidades</h3>
          <div className="exp-mini-content">
            <span className="material-icons exp-icon">location_city</span>
            <div className="exp-text">
              <h2>{qtdCidades}</h2>
            </div>
          </div>
        </div>

        <div className="exp-metric-card glow">
          <h3>Crescimento Populacional</h3>
          <div className="exp-mini-content">
            <span className="material-icons exp-icon">trending_up</span>
            <div className="exp-text">
              <p className="green-text">
                {anoIni} → {anoFin}
              </p>
              <h2>{crescimentoPerc.toFixed(2)}%</h2>
            </div>
          </div>
        </div>

        <div className="exp-metric-card glow">
          <h3>População Total</h3>
          <div className="exp-mini-content">
            <span className="material-icons exp-icon">groups</span>
            <div className="exp-text">
              <p className="green-text">Ano {anoFin}</p>
              <h2>{totalPopFin.toLocaleString("pt-BR")}</h2>
            </div>
          </div>
        </div>
      </div>

      <div className="exp-charts-row">
        {/* ===== População total por ano (75%) ===== */}
        <div className="card glow exp-line-card">
          <h3>
            População Total por Ano ({Math.min(anoIni, anoFin)}–
            {Math.max(anoIni, anoFin)})
          </h3>
          <div className="home-line-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={lineData}
                margin={
                  isMobile
                    ? { top: 12, right: 12, bottom: 34, left: 6 }
                    : { top: 12, right: 18, bottom: 30, left: 12 }
                }
              >
                <CartesianGrid stroke="#dfe9e3" strokeDasharray="3 3" />
                <XAxis
                  dataKey="year"
                  type="category"
                  interval={0}
                  ticks={lineTickValues}
                  tick={{ fill: "#1b3c2e", fontSize: isMobile ? 9 : 11 }}
                  tickLine={{ stroke: "#dfe9e3" }}
                  axisLine={{ stroke: "#dfe9e3" }}
                  height={isMobile ? 36 : 30}
                  label={{
                    value: "Ano",
                    position: "insideBottom",
                    offset: -4,
                    fill: "#1b3c2e",
                    fontWeight: 700,
                  }}
                />
                <YAxis
                  type="number"
                  domain={["auto", "auto"]}
                  tick={{ fill: "#1b3c2e", fontSize: isMobile ? 10 : 11 }}
                  tickFormatter={(value) => Number(value).toLocaleString("pt-BR")}
                  tickLine={{ stroke: "#dfe9e3" }}
                  axisLine={{ stroke: "#dfe9e3" }}
                  width={isMobile ? 56 : 72}
                  label={{
                    value: "População",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#1b3c2e",
                    fontWeight: 700,
                    dx: isMobile ? 0 : -2,
                  }}
                />
                <ReTooltip
                  formatter={(value) => Number(value).toLocaleString("pt-BR")}
                  labelFormatter={(label) => `Ano ${label}`}
                  contentStyle={{
                    border: "1px solid #1b5e20",
                    borderRadius: 8,
                    color: "#1b5e20",
                  }}
                />
                <Area
                  type="linear"
                  dataKey="total"
                  stroke="#1b5e20"
                  fill="#1b5e20"
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
                <ReLine
                  type="linear"
                  dataKey="total"
                  stroke="#1b5e20"
                  strokeWidth={3}
                  dot={{ r: 3, fill: "#f5fbf7", stroke: "#1b5e20", strokeWidth: 2 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ===== Pie de distribuição (25%) ===== */}
        <div className="card glow exp-pie-card">
          <h3>Distribuição Populacional (%) – {anoFin}</h3>
          <div className="exp-chart-wrapper">
            {pieData.length ? (
              <ResponsivePie
                data={pieData}
                margin={isMobile ? { top: 16, right: 16, bottom: 16, left: 16 } : { top: 18, right: 18, bottom: 18, left: 18 }}
                innerRadius={isMobile ? 0.5 : 0.62}
                padAngle={1}
                cornerRadius={4}
                activeOuterRadiusOffset={6}
                colors={{ datum: "data.color" }}
                borderWidth={1}
                borderColor={{ from: "color", modifiers: [["darker", 0.3]] }}
                enableArcLabels={!isMobile}
                arcLabelsSkipAngle={18}
                arcLabelsTextColor={{
                  from: "color",
                  modifiers: [["darker", 3]],
                }}
                arcLabel={(d) => `${d.value}%`}
                enableArcLinkLabels={false}
                tooltip={({ datum }) => (
                  <div
                    style={{
                      padding: "6px 9px",
                      background: "#fff",
                      border: "1px solid #1b5e20",
                      borderRadius: 8,
                      color: "#1b5e20",
                      fontSize: ".9rem",
                      fontWeight: 700,
                    }}
                  >
                    {datum.id}: {datum.value}%
                  </div>
                )}
                theme={{
                  textColor: "#1b3c2e",
                  fontSize: 12,
                }}
                animate={false}
                motionConfig="gentle"
              />
            ) : (
              <div className="exp-chart-empty">Sem dados disponíveis</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Auxiliares
========================================================= */
function RemoveButton({ onRemove }) {
  const [selected, setSelected] = useState(new Set());
  useEffect(() => {
    const handler = (e) => setSelected(new Set(e.detail.indexes));
    window.addEventListener("exp:selectedIndexes", handler);
    return () => window.removeEventListener("exp:selectedIndexes", handler);
  }, []);
  return (
    <button
      className="btn-secondary"
      onClick={() => onRemove(selected)}
      disabled={selected.size === 0}
      title={
        selected.size === 0
          ? "Selecione linhas para remover"
          : "Remover selecionadas"
      }
    >
      <span
        className="material-icons"
        style={{ marginRight: 6, fontSize: 18 }}
      >
        delete
      </span>
      Remover
    </button>
  );
}

function ExpTable({ rows, anoIni, anoFin }) {
  const [selected, setSelected] = useState(new Set());
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("exp:selectedIndexes", {
        detail: { indexes: Array.from(selected) },
      })
    );
  }, [selected]);

  const cols = useMemo(() => {
    const a = Math.min(anoIni, anoFin);
    const b = Math.max(anoIni, anoFin);
    const arr = [];
    for (let y = a; y <= b; y++) arr.push(y);
    return arr;
  }, [anoIni, anoFin]);

  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="exp-table-wrap">
      <div className="exp-scroll">
        <table
          className="exp-table"
          style={{ minWidth: 320 + cols.length * 120 }}
        >
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(e) =>
                    e.target.checked
                      ? setSelected(new Set(rows.map((_, i) => i)))
                      : setSelected(new Set())
                  }
                />
              </th>
              <th className="col-uf">UF</th>
              <th className="col-nome">NOME</th>
              {cols.map((y) => (
                <th key={y} className="col-ano">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.uf}-${r.nome}`}
                className={selected.has(i) ? "is-selected" : ""}
                onClick={() => {
                  const next = new Set(selected);
                  next.has(i) ? next.delete(i) : next.add(i);
                  setSelected(next);
                }}
              >
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {}}
                  />
                </td>
                <td className="col-uf">{r.uf}</td>
                <td className="col-nome">{r.nome}</td>
                {cols.map((y) => (
                  <td key={y} className="col-ano">
                    {toPopNumber(r.series?.[y]).toLocaleString("pt-BR")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
