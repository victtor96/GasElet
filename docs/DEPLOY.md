# Deploy Guide

Este guia foca em deploy seguro com frontend e backend servidos em HTTPS sem erro de Mixed Content.

## Objetivo

Garantir:

- aplicação carregada em HTTPS;
- API também acessada via HTTPS (mesma origem, preferencialmente);
- cookies de autenticação funcionando corretamente.

## Estratégia recomendada

1. Gerar build do frontend (`client/dist`).
2. Executar backend Drogon em porta interna (ex.: `7080`).
3. Expor via reverse proxy/Tunnel com TLS.
4. Manter frontend e API no mesmo domínio.

## Passo a passo

### 1) Build frontend

```bash
cd client
npm ci
npm run build
```

### 2) Build backend

```bash
cd server
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

### 3) Variáveis de ambiente

Backend:

- `JWT_SECRET` com valor forte.
- opcional: `DROGON_CONFIG_FILE`.

Frontend (build):

- `VITE_API_BASE` vazio (`""`) para mesma origem em produção.

### 4) Executar backend

```bash
cd server
JWT_SECRET="seu-segredo-forte" ./build/drogon-react-ws
```

## Cloudflare Tunnel

Se usar Cloudflare Tunnel:

- publique apenas URL HTTPS externa;
- o serviço interno pode continuar em HTTP local;
- evite build do frontend com `VITE_API_BASE=http://IP:PORT`.

Problema clássico:

- página HTTPS tentando acessar API HTTP -> navegador bloqueia (Mixed Content).

Correção:

- use mesma origem HTTPS (ou `VITE_API_BASE` HTTPS).

## Checklist de validação pós-deploy

- login funciona sem erros de Mixed Content;
- `GET /me` retorna 200 autenticado;
- `GET /api/user/dashboard` salva e recarrega estado;
- refresh da página mantém cenário atual;
- logout remove sessão com sucesso.

## Hardening recomendado

- rotacionar `JWT_SECRET`;
- habilitar logs estruturados;
- backups de `Dados/users/*.json`;
- monitorar falhas de autenticação;
- colocar rate-limit no login/signup.
