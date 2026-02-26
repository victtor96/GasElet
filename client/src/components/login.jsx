// File: src/components/EcoLogin.jsx (React)
import React, { useState } from "react";
import "../styles/login.css"; // CSS separado

/**
 * EcoLogin – Tela de login moderna com tema ambiental (CSS puro)
 * - Glassmorphism + gradiente ecológico
 * - Rótulos flutuantes, mostrar/ocultar senha
 * - Acessível e responsiva
 */
export default function EcoLogin({ onSubmit }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const u = username.trim();
    const p = password;
    if (u.length < 3) return setError("Usuário muito curto");
    if (p.length < 8) return setError("Senha precisa de no mínimo 8 caracteres");
    try {
      setLoading(true);
      await onSubmit?.(u, p, remember);
    } catch (err) {
      setError(err?.message || "Falha no login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="eco-root">
      {/* orbes/folhas de fundo */}
      <div className="eco-orb eco-orb--1" />
      <div className="eco-orb eco-orb--2" />

      <div className="eco-leaves" aria-hidden>
        <svg viewBox="0 0 1200 800" preserveAspectRatio="none">
          <defs>
            <linearGradient id="leafG" x1="0" x2="1">
              <stop offset="0%" stopColor="#7de2a7"/>
              <stop offset="100%" stopColor="#c9f2dd"/>
            </linearGradient>
          </defs>
          <g fill="url(#leafG)">
            <path d="M150 700 C 240 540, 340 520, 520 360 C 340 420, 240 540, 150 700 Z" opacity=".35"/>
            <path d="M980 120 C 850 240, 740 320, 640 480 C 820 400, 890 240, 980 120 Z" opacity=".28"/>
            <path d="M1080 700 C 960 620, 900 560, 820 480 C 960 520, 1020 620, 1080 700 Z" opacity=".22"/>
          </g>
        </svg>
      </div>

      {/* cartão */}
      <section className="eco-card" aria-label="Área de login">
        <header className="eco-brand">
          <div className="eco-logo" aria-hidden>🌿</div>
          <div>
            <h1 className="eco-title">Entrar na Plataforma GasElet</h1>
            <p className="eco-sub">Soluções limpas para um futuro sustentável</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          {/* usuário */}
          <div className="eco-field">
            <input
              id="eco-user"
              className="eco-input"
              type="text"
              autoComplete="username"
              placeholder="Usuário"
              aria-label="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={!!error && username.trim().length < 3}
              aria-describedby="eco-err"
            />
          </div>

          {/* senha */}
          <div className="eco-field">
            <input
              id="eco-pass"
              className="eco-input"
              type="password"
              autoComplete="current-password"
              placeholder="Senha"
              aria-label="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error && password.length < 8}
              aria-describedby="eco-err"
            />
          </div>

          <div className="eco-row">
            <label className="eco-remember">
              <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} />
              Lembrar de mim
            </label>
            <a className="eco-link" href="#recuperar">Esqueceu a senha?</a>
          </div>

          <button className="eco-btn" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>

          {error && (
            <div id="eco-err" className="eco-error" role="alert">
              {error}
            </div>
          )}

          <p className="eco-hint">Dica: use uma senha com letras, números e símbolos. 🌱</p>
        </form>

        <footer className="eco-footer">
          <span>Não tem conta?</span>
          <a className="eco-link" href="#criar">Criar nova conta</a>
        </footer>
      </section>
    </div>
  );
}
