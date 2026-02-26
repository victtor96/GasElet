import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.jsx";
import ProtectedLayout from "./layouts/ProtectedLayout.jsx";
import Home from "./pages/Home.jsx";
import Rsu from "./pages/Rsu.jsx";
import Charts from "./pages/Charts.jsx";
import Energy from "./pages/Energy.jsx";

import LoginPage from "./pages/Login.jsx";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Rota pública */}
          <Route path="/login" element={<LoginPage />} />

          {/* Rotas protegidas */}
          <Route element={<ProtectedLayout />}>
            <Route index element={<Home />} />
            <Route path="/" element={<Home />} />
            <Route path="/rsu" element={<Rsu />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/energy" element={<Energy />} />
            {/* adicione mais páginas protegidas aqui */}
          </Route>

          {/* fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
