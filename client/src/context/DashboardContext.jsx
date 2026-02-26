import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const DashboardCtx = createContext(null);

const API_BASE =
  (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "/backend" : "");
const DASHBOARD_API = `${API_BASE}/api/user/dashboard`;
const SCENARIO_STORAGE_PREFIX = "dashboard:lastScenarioId:";
const DASHBOARD_BACKUP_PREFIX = "dashboard:backup:";
const DASHBOARD_LAST_BACKUP_KEY = `${DASHBOARD_BACKUP_PREFIX}last`;

function buildDefaultScenario() {
  return {
    id: "default",
    name: "Cenário 1",
    anoInicial: 2000,
    anoFinal: 2060,
    rows: [],
  };
}

function normalizeScenario(rawScenario, index) {
  const safe = rawScenario && typeof rawScenario === "object" ? rawScenario : {};
  const fallbackId = `scenario-${index + 1}`;
  const id = safe.id == null || safe.id === "" ? fallbackId : String(safe.id);
  const name =
    typeof safe.name === "string" && safe.name.trim()
      ? safe.name
      : `Cenário ${index + 1}`;
  const anoInicial = Number.isFinite(Number(safe.anoInicial))
    ? Number(safe.anoInicial)
    : 2000;
  const anoFinal = Number.isFinite(Number(safe.anoFinal))
    ? Number(safe.anoFinal)
    : 2060;
  const rows = Array.isArray(safe.rows) ? safe.rows : [];

  return {
    ...safe,
    id,
    name,
    anoInicial,
    anoFinal,
    rows,
  };
}

function normalizeScenarios(rawScenarios) {
  if (!Array.isArray(rawScenarios)) return [];
  return rawScenarios.map((scenario, index) => normalizeScenario(scenario, index));
}

function scenarioStorageKey(userKey) {
  return `${SCENARIO_STORAGE_PREFIX}${String(userKey || "").trim()}`;
}

function readStoredScenarioId(userKey) {
  if (typeof window === "undefined" || !userKey) return null;
  try {
    const raw = window.localStorage.getItem(scenarioStorageKey(userKey));
    if (!raw) return null;
    return String(raw);
  } catch {
    return null;
  }
}

function writeStoredScenarioId(userKey, scenarioId) {
  if (typeof window === "undefined" || !userKey || !scenarioId) return;
  try {
    window.localStorage.setItem(scenarioStorageKey(userKey), String(scenarioId));
  } catch {
    // no-op
  }
}

function backupStorageKey(userKey) {
  const normalized = String(userKey || "").trim() || "__anon__";
  return `${DASHBOARD_BACKUP_PREFIX}${normalized}`;
}

function normalizeDashboardPayload(rawPayload) {
  const safe = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const normalizedScenarios = normalizeScenarios(safe.scenarios);
  const scenarios = normalizedScenarios.length
    ? normalizedScenarios
    : [buildDefaultScenario()];

  const requestedScenarioId =
    safe.currentScenarioId == null || safe.currentScenarioId === ""
      ? null
      : String(safe.currentScenarioId);

  const resolvedScenarioId =
    requestedScenarioId &&
    scenarios.some((scenario) => String(scenario.id) === String(requestedScenarioId))
      ? requestedScenarioId
      : String(scenarios[0].id);

  const rsuByScenario =
    safe && typeof safe.rsuByScenario === "object" && safe.rsuByScenario
      ? safe.rsuByScenario
      : {};

  return {
    name: safe.name || safe.username || "",
    role: safe.role || "Operador",
    scenarios,
    currentScenarioId: resolvedScenarioId,
    rsuByScenario,
  };
}

function parseBackup(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const hasWrappedPayload = parsed.payload && typeof parsed.payload === "object";
    const payload = normalizeDashboardPayload(hasWrappedPayload ? parsed.payload : parsed);
    const updatedAt = Number(parsed.updatedAt);
    const normalizedUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : 0;
    const userKey = String(parsed.userKey || "").trim();

    return { payload, updatedAt: normalizedUpdatedAt, userKey };
  } catch {
    return null;
  }
}

function readDashboardBackup(userKey) {
  if (typeof window === "undefined") return null;
  try {
    return parseBackup(window.localStorage.getItem(backupStorageKey(userKey)));
  } catch {
    return null;
  }
}

function readLastDashboardBackup() {
  if (typeof window === "undefined") return null;
  try {
    return parseBackup(window.localStorage.getItem(DASHBOARD_LAST_BACKUP_KEY));
  } catch {
    return null;
  }
}

function writeDashboardBackup(userKey, payload) {
  if (typeof window === "undefined") return;
  try {
    const record = {
      userKey: String(userKey || "").trim(),
      updatedAt: Date.now(),
      payload: normalizeDashboardPayload(payload),
    };
    const serialized = JSON.stringify(record);
    window.localStorage.setItem(backupStorageKey(userKey), serialized);
    window.localStorage.setItem(DASHBOARD_LAST_BACKUP_KEY, serialized);
  } catch {
    // no-op
  }
}

function isLikelyDefaultPayload(payload) {
  if (!payload || !Array.isArray(payload.scenarios) || payload.scenarios.length !== 1) {
    return false;
  }
  const single = payload.scenarios[0];
  const rowsCount = Array.isArray(single?.rows) ? single.rows.length : 0;
  const rsuCount =
    payload.rsuByScenario && typeof payload.rsuByScenario === "object"
      ? Object.keys(payload.rsuByScenario).length
      : 0;
  return rowsCount === 0 && rsuCount === 0;
}

export function DashboardProvider({ children }) {
  const [loadingUser, setLoadingUser] = useState(true);
  const [userKey, setUserKey] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [errorUser, setErrorUser] = useState(null);

  const [scenarios, setScenarios] = useState([]);
  const [currentScenarioId, setCurrentScenarioId] = useState(null);
  const [rsuByScenario, setRsuByScenario] = useState({});
  const [savingScenario, setSavingScenario] = useState(false);
  const [errorScenario, setErrorScenario] = useState(null);
  const hasHydratedRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const autoSaveTimerRef = useRef(null);
  const setCurrentScenarioIdSafe = useCallback((nextScenarioId) => {
    setCurrentScenarioId((prev) => {
      const resolved =
        typeof nextScenarioId === "function"
          ? nextScenarioId(prev)
          : nextScenarioId;
      if (resolved == null || resolved === "") return null;
      return String(resolved);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingUser(true);
        const resp = await fetch(DASHBOARD_API, {
          method: "GET",
          credentials: "include",
        });

        if (!resp.ok) {
          throw new Error(`Erro HTTP ${resp.status}`);
        }

        const json = await resp.json();
        if (cancelled) return;

        const resolvedUserKey = String(json.username || json.name || "").trim();
        const serverPayload = normalizeDashboardPayload(json);
        const localBackup = readDashboardBackup(resolvedUserKey);
        const shouldUseBackup =
          localBackup?.payload &&
          isLikelyDefaultPayload(serverPayload) &&
          !isLikelyDefaultPayload(localBackup.payload);
        const sourcePayload = shouldUseBackup ? localBackup.payload : serverPayload;
        const resolvedName = json.name || json.username || sourcePayload.name || "";
        const resolvedRole = json.role || sourcePayload.role || "Operador";

        setUserKey(resolvedUserKey);
        setUserName(resolvedName);
        setUserRole(resolvedRole);

        setScenarios(sourcePayload.scenarios);
        const localScenarioId = readStoredScenarioId(resolvedUserKey);
        const preferredScenarioId = [localScenarioId, sourcePayload.currentScenarioId].find(
          (scenarioId) =>
            scenarioId &&
            sourcePayload.scenarios.some(
              (scenario) => String(scenario.id) === String(scenarioId)
            )
        );
        setCurrentScenarioId(String(preferredScenarioId || sourcePayload.scenarios[0].id));
        setRsuByScenario(sourcePayload.rsuByScenario);
        writeDashboardBackup(resolvedUserKey, {
          ...sourcePayload,
          name: resolvedName,
          role: resolvedRole,
        });

        setErrorUser(null);
      } catch (e) {
        if (cancelled) return;
        console.error("Erro ao carregar dashboard do usuário:", e);
        const backup = readLastDashboardBackup();

        if (backup?.payload) {
          const fallbackUserKey = String(backup.userKey || "").trim();
          const localScenarioId = readStoredScenarioId(fallbackUserKey);
          const preferredScenarioId = [
            localScenarioId,
            backup.payload.currentScenarioId,
          ].find(
            (scenarioId) =>
              scenarioId &&
              backup.payload.scenarios.some(
                (scenario) => String(scenario.id) === String(scenarioId)
              )
          );

          setUserKey(fallbackUserKey);
          setUserName(backup.payload.name || "");
          setUserRole(backup.payload.role || "Operador");
          setScenarios(backup.payload.scenarios);
          setCurrentScenarioId(
            String(preferredScenarioId || backup.payload.scenarios[0]?.id || "default")
          );
          setRsuByScenario(backup.payload.rsuByScenario);
          setErrorUser("Falha ao carregar dados do servidor. Usando cache local.");
        } else {
          const defaultScenario = buildDefaultScenario();
          setErrorUser("Falha ao carregar dados do usuário");
          setUserKey("");
          setScenarios([defaultScenario]);
          setCurrentScenarioId(defaultScenario.id);
          setRsuByScenario({});
        }
      } finally {
        if (!cancelled) setLoadingUser(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!Array.isArray(scenarios) || scenarios.length === 0) return;
    if (
      !currentScenarioId ||
      !scenarios.some((s) => String(s.id) === String(currentScenarioId))
    ) {
      setCurrentScenarioId(String(scenarios[0].id));
    }
  }, [scenarios, currentScenarioId]);

  useEffect(() => {
    if (!userKey || !currentScenarioId) return;
    writeStoredScenarioId(userKey, currentScenarioId);
  }, [userKey, currentScenarioId]);

  const payload = useMemo(
    () => ({
      name: userName,
      role: userRole,
      scenarios,
      currentScenarioId,
      rsuByScenario,
    }),
    [userName, userRole, scenarios, currentScenarioId, rsuByScenario]
  );

  const payloadSignature = useMemo(() => JSON.stringify(payload), [payload]);

  const saveScenarios = useCallback(async (options = {}) => {
    const { silent = false, keepalive = false } = options;
    let saved = false;
    if (!silent) {
      setSavingScenario(true);
    }
    setErrorScenario(null);
    try {
      const resp = await fetch(DASHBOARD_API, {
        method: "POST",
        keepalive,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Erro HTTP ${resp.status} ao salvar dashboard`);
      }
      lastSavedSignatureRef.current = payloadSignature;
      saved = true;
    } catch (e) {
      console.error(e);
      setErrorScenario(e?.message ?? "Erro ao salvar cenário");
    } finally {
      if (!silent) {
        setSavingScenario(false);
      }
    }
    return saved;
  }, [payload, payloadSignature]);

  const flushPendingChanges = useCallback(async (options = {}) => {
    const { keepalive = false, silent = true } = options;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (loadingUser) return true;
    if (!Array.isArray(scenarios) || scenarios.length === 0) return true;
    if (payloadSignature === lastSavedSignatureRef.current) return true;
    return saveScenarios({ keepalive, silent });
  }, [loadingUser, scenarios, payloadSignature, saveScenarios]);

  useEffect(() => {
    if (loadingUser) return;
    if (!Array.isArray(scenarios) || scenarios.length === 0) return;
    writeDashboardBackup(userKey, payload);
  }, [loadingUser, scenarios, userKey, payload]);

  useEffect(() => {
    if (loadingUser) return;
    if (!Array.isArray(scenarios) || scenarios.length === 0) return;

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      lastSavedSignatureRef.current = payloadSignature;
      return;
    }

    if (payloadSignature === lastSavedSignatureRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void saveScenarios({ silent: true });
    }, 350);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [loadingUser, scenarios, payloadSignature, saveScenarios]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const flushOnLifecycle = () => {
      void flushPendingChanges({ silent: true, keepalive: true });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushOnLifecycle();
      }
    };

    window.addEventListener("pagehide", flushOnLifecycle);
    window.addEventListener("beforeunload", flushOnLifecycle);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pagehide", flushOnLifecycle);
      window.removeEventListener("beforeunload", flushOnLifecycle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushPendingChanges]);

  return (
    <DashboardCtx.Provider
      value={{
        loadingUser,
        userName,
        userRole,
        errorUser,
        scenarios,
        setScenarios,
        currentScenarioId,
        setCurrentScenarioId: setCurrentScenarioIdSafe,
        rsuByScenario,
        setRsuByScenario,
        savingScenario,
        errorScenario,
        setErrorScenario,
        saveScenarios,
        flushPendingChanges,
      }}
    >
      {children}
    </DashboardCtx.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardCtx);
}
