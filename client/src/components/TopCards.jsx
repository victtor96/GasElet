import React from "react";

export default function TopCards({
  scenarios,
  currentScenarioId,
  onScenarioChange,
  onCreateScenario,
  onDeleteScenario,
  onSaveScenario,
  savingScenario,
  errorScenario,
  disableSave,
  saveTitle,
  userName,
  userRole,
  errorUser,
}) {
  const hasScenarios = Array.isArray(scenarios) && scenarios.length > 0;

  return (
    <div className="top-row">
      <div className="card glow scenario-card">
        <div className="scenario-card-header">
          <span className="material-icons scenario-icon">layers</span>
          <div>
            <h4>Cenário / Aterro</h4>
            <small>Gerencie combinações de cidades</small>
          </div>
        </div>

        <div className="scenario-card-body">
          <div className="select-wrap compact">
            <select value={currentScenarioId || ""} onChange={onScenarioChange} disabled={!hasScenarios}>
              {hasScenarios ? (
                scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              ) : (
                <option value="">Sem cenários</option>
              )}
            </select>
            <span className="chev">▾</span>
          </div>

          <div className="scenario-buttons">
            <button className="icon-btn" type="button" onClick={onCreateScenario} title="Novo cenário">
              <span className="material-icons">add</span>
            </button>

            <button
              className="icon-btn"
              type="button"
              onClick={onDeleteScenario}
              disabled={!hasScenarios || scenarios.length <= 1}
              title={
                !hasScenarios || scenarios.length <= 1
                  ? "Mantenha pelo menos um cenário"
                  : "Excluir cenário atual"
              }
            >
              <span className="material-icons">delete</span>
            </button>

            <button
              className="icon-btn primary"
              type="button"
              onClick={onSaveScenario}
              disabled={savingScenario || disableSave || !hasScenarios}
              title={
                !hasScenarios
                  ? "Crie um cenário primeiro"
                  : saveTitle || "Salvar dashboard do usuário"
              }
            >
              <span className="material-icons">
                {savingScenario ? "hourglass_top" : "cloud_upload"}
              </span>
            </button>
          </div>
        </div>

        {errorScenario && <small className="error-text scenario-error">{errorScenario}</small>}
      </div>

      <div className="card glow user-card">
        <div className="user-card-inner">
          <div className="user-avatar">
            <span className="material-icons">person</span>
          </div>
          <div className="user-info">
            <h4>Usuário</h4>
            <p className="user-name">{userName || "Usuário autenticado"}</p>
            <span className="user-role-pill">Nível: {userRole || "Operador"}</span>
            {errorUser && (
              <small className="error-text" style={{ marginTop: 4 }}>
                {errorUser}
              </small>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
