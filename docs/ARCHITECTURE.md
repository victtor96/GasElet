# Arquitetura

## Visão geral

O sistema é composto por:

- **SPA React/Vite** (camada de apresentação e interação);
- **API C++/Drogon** (autenticação, persistência e cálculos);
- **persistência em JSON por usuário**;
- **WebSocket** para mensagens em tempo real;
- **servidor TCP auxiliar** na porta `2020`.

## Fluxo de autenticação

1. `POST /login` valida credenciais.
2. Backend emite JWT com `issuer=aterro_web` e expiração ~12h.
3. JWT é retornado e gravado em cookie HttpOnly (`access_token`).
4. Rotas protegidas validam token via `AuthFilter`.
5. Frontend consulta `GET /me` para hidratar sessão.

## Fluxo de dados do dashboard

1. Frontend carrega `GET /api/user/dashboard`.
2. Usuário altera cenários/configurações.
3. Frontend realiza autosave para `POST /api/user/dashboard`.
4. Backend aplica merge e recalcula séries derivadas.
5. Dados são salvos em `Dados/users/<username>.json`.

## Cálculo de metano e RSU

O backend centraliza a lógica analítica:

- coeficientes regionais e geração per capita;
- cálculo de RSU por ano;
- composição do resíduo e parâmetros de decaimento;
- cálculo de emissões anuais totais e por cidade;
- resposta pronta para gráficos do frontend.

Endpoint dedicado: `POST /api/user/landfill/calc`.

## Segurança aplicada

- JWT assinado com segredo (`JWT_SECRET`).
- Cookie HttpOnly + `SameSite=Lax`.
- `Secure` habilitado automaticamente em conexões HTTPS.
- Cadastro (`/signup`) permitido apenas em localhost da própria máquina.
- Filtro de autenticação em rotas sensíveis.
- Sanitização de nome de arquivo em `/api/json/{name}`.

## SPA fallback e proteção de rotas

O backend entrega `index.html` para rotas SPA sem extensão e:

- mantém `/login` público;
- protege demais rotas com validação de token;
- redireciona não autenticado para `/login`.

## Persistência

- `Dados/users/users.json`: credenciais (hash bcrypt).
- `Dados/users/<username>.json`: estado do dashboard.
- Frontend usa `localStorage` como fallback de resiliência.

## Limitações atuais

- persistência em JSON local (não relacional);
- ausência de suíte completa de testes automatizados;
- dependência de configuração manual para deploy.

## Evolução recomendada

- banco de dados (PostgreSQL/SQLite);
- camada de serviço para regras de negócio;
- testes unitários/integrados;
- CI/CD com validações automáticas.
