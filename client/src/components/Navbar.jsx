import React, { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { FaHome, FaUser, FaTrash, FaChartPie, FaBolt, FaSignOutAlt } from "react-icons/fa";
import { useDashboard } from "../context/DashboardContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import "../styles/Navbar.css";

export default function Navbar() {
  const [isVisible, setIsVisible] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const hideTimerRef = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const {
    loadingUser,
    userName,
    userRole,
    scenarios,
    setScenarios,
    currentScenarioId,
    setCurrentScenarioId,
    flushPendingChanges,
  } = useDashboard();

  useEffect(() => {
    const onActivity = () => {
      setIsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 3000);
    };

    window.addEventListener("scroll", onActivity, { passive: true });
    window.addEventListener("touchmove", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
    return () => {
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("touchmove", onActivity);
      window.removeEventListener("touchstart", onActivity);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);
  const items = [
    { id: "home", icon: <FaHome />, label: "Início", path: "/" },
    { id: "trash", icon: <FaTrash />, label: "Resíduos", path: "/rsu" },
    { id: "chart", icon: <FaChartPie />, label: "Gráficos", path: "/charts" },
    { id: "energy", icon: <FaBolt />, label: "Energia", path: "/energy" },
  ];
  const hasScenarios = Array.isArray(scenarios) && scenarios.length > 0;
  const selectedScenarioId =
    currentScenarioId != null
      ? String(currentScenarioId)
      : hasScenarios
      ? String(scenarios[0].id)
      : "";
  const currentScenario =
    hasScenarios
      ? scenarios.find((scenario) => String(scenario.id) === selectedScenarioId) || scenarios[0]
      : null;

  const handleCreateScenario = () => {
    const scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setScenarios((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const usedNames = new Set(safePrev.map((s) => String(s?.name || "").trim()));
      let nextNumber = safePrev.length + 1;
      let nextName = `Cenário ${nextNumber}`;
      while (usedNames.has(nextName)) {
        nextNumber += 1;
        nextName = `Cenário ${nextNumber}`;
      }

      const nextScenario = {
        id: scenarioId,
        name: nextName,
        anoInicial: Number(currentScenario?.anoInicial) || 2000,
        anoFinal: Number(currentScenario?.anoFinal) || 2060,
        rows: [],
      };
      return [...safePrev, nextScenario];
    });
    setCurrentScenarioId(scenarioId);
  };

  const handleDeleteScenario = () => {
    if (!hasScenarios || scenarios.length <= 1) return;
    const confirmed = window.confirm("Deseja excluir o cenário atual?");
    if (!confirmed) return;

    setScenarios((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const selectedIndex = safePrev.findIndex((s) => String(s.id) === selectedScenarioId);
      if (selectedIndex < 0) return safePrev;

      const next = safePrev.filter((s) => String(s.id) !== selectedScenarioId);
      if (!next.length) return safePrev;

      const fallback =
        next[Math.min(selectedIndex, next.length - 1)] || next[0];
      setCurrentScenarioId(String(fallback.id));
      return next;
    });
  };

  const handleRenameScenario = () => {
    if (!currentScenario) return;
    const nextName = window.prompt(
      "Novo nome do cenário:",
      String(currentScenario.name || "")
    );
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;

    setScenarios((prev) =>
      (Array.isArray(prev) ? prev : []).map((scenario) =>
        String(scenario.id) === selectedScenarioId
          ? { ...scenario, name: trimmed }
          : scenario
      )
    );
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    let shouldNavigate = false;
    try {
      const didSave = await flushPendingChanges({ silent: true });
      if (!didSave) {
        const shouldExit = window.confirm(
          "Nao foi possivel salvar as alteracoes agora. Deseja sair mesmo assim?"
        );
        if (!shouldExit) return;
      }
      await logout();
      shouldNavigate = true;
    } finally {
      if (shouldNavigate) {
        navigate("/login", { replace: true });
      }
      setIsLoggingOut(false);
    }
  };

  return (
    <div className={`nav-container ${isVisible ? "nav-visible" : ""}`}>
      <nav className="navbar">
        <div className="nav-top">
          <div className="nav-icons">
            {items.map((item) => (
              <NavLink
                key={item.id}
                to={item.path}
                className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="nav-bottom">
          <div className="nav-scenario-stack">
            <label htmlFor="nav-scenario" className="nav-panel-label">Cenário</label>
            <div className="nav-scenario-row">
              <select
                id="nav-scenario"
                value={selectedScenarioId}
                onChange={(e) => setCurrentScenarioId(e.target.value || null)}
                disabled={!hasScenarios}
              >
                {hasScenarios ? (
                  scenarios.map((scenario) => (
                    <option key={scenario.id} value={String(scenario.id)}>
                      {scenario.name}
                    </option>
                  ))
                ) : (
                  <option value="">Sem cenários</option>
                )}
              </select>

              <div className="nav-scenario-actions">
                <button
                  type="button"
                  className="nav-scenario-btn"
                  onClick={handleCreateScenario}
                  title="Novo cenário"
                >
                  <span className="material-icons">add</span>
                </button>
                <button
                  type="button"
                  className="nav-scenario-btn"
                  onClick={handleRenameScenario}
                  disabled={!hasScenarios}
                  title="Renomear cenário"
                >
                  <span className="material-icons">edit</span>
                </button>
                <button
                  type="button"
                  className="nav-scenario-btn danger"
                  onClick={handleDeleteScenario}
                  disabled={!hasScenarios || scenarios.length <= 1}
                  title={
                    !hasScenarios || scenarios.length <= 1
                      ? "Mantenha pelo menos um cenário"
                      : "Excluir cenário atual"
                  }
                >
                  <span className="material-icons">delete</span>
                </button>
              </div>
            </div>
          </div>

          <NavLink to="/" className="nav-btn small nav-user-btn">
            <span className="nav-icon">
              <FaUser />
            </span>
            <span className="nav-label">{loadingUser ? "Carregando..." : userName || "Usuário"}</span>
            {!loadingUser && <span className="nav-user-role">{userRole || "Operador"}</span>}
          </NavLink>
          <button
            type="button"
            className="nav-btn small nav-logout-btn"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title={isLoggingOut ? "Saindo..." : "Sair"}
          >
            <span className="nav-icon">
              <FaSignOutAlt />
            </span>
            <span className="nav-label">{isLoggingOut ? "Saindo..." : "Sair"}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
