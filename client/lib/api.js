const API =
  (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "/backend" : "");

async function api(path, { method="GET", body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(headers || {}) },
    credentials: "include", // envia cookie HttpOnly
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const AuthAPI = {
  signup: (u,p) => api("/signup", { method:"POST", body:{ username:u, password:p } }),
  login:  (u,p) => api("/login",  { method:"POST", body:{ username:u, password:p } }),
  me:           () => api("/me"),
  logout:       () => api("/logout", { method:"POST" }),
};
