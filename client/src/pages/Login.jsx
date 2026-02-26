// src/pages/Login.jsx
import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import EcoLogin from "../components/login";

export default function LoginPage() {
  const { user, login, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = location.state?.from?.pathname || "/home";

  // se já estiver logado (ex.: voltou ao /login), manda p/ destino
  useEffect(() => {
    if (ready && user) navigate(dest, { replace: true });
  }, [ready, user, dest, navigate]);

  const handleLogin = async (u, p) => {
    await login(u, p);              // faz POST /login e depois refresh() no contexto
    navigate(dest, { replace: true }); // redireciona sem recarregar a página
  };

  return <EcoLogin onSubmit={handleLogin} />;
}
