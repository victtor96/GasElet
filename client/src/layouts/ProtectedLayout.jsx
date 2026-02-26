// src/layouts/ProtectedLayout.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Navbar from "../components/Navbar";
import { DashboardProvider } from "../context/DashboardContext.jsx";

export default function ProtectedLayout() {
  const { user, ready } = useAuth();
  const location = useLocation();
  const isDev = Boolean(import.meta?.env?.DEV);

  if (isDev) {
    return (
      <DashboardProvider>
        <Navbar />
        <Outlet />
      </DashboardProvider>
    );
  }

  if (!ready) {
    return <div style={{minHeight:"100vh",display:"grid",placeItems:"center"}}>Carregando…</div>;
  }
  if (!user) {
    // passa a rota atual para o login (para voltar depois)
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return (
    <DashboardProvider>
      <Navbar />
      <Outlet />
    </DashboardProvider>
  );
}
