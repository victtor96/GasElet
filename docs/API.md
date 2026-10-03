# API Reference

Base URL local padrão: `http://localhost:7080`

Autenticação:

- Cookie HttpOnly `access_token` (padrão do frontend).
- Ou header `Authorization: Bearer <token>`.

## Endpoints de Autenticação

### `POST /signup`

Cria usuário (ou atualiza senha de usuário existente).  
Restrito ao localhost da máquina do servidor.

Request:

```json
{
  "username": "usuario",
  "password": "Senha@123"
}
```

Responses comuns:

- `201`: usuário criado
- `200`: senha atualizada
- `400`: dados inválidos
- `403`: fora do localhost
- `500`: erro interno

### `POST /login`

Autentica e retorna token. Também grava cookie HttpOnly.

Request:

```json
{
  "username": "usuario",
  "password": "Senha@123"
}
```

Response (`200`):

```json
{
  "token": "<jwt>",
  "expires_in_hours": 12
}
```

### `GET /me`

Retorna usuário autenticado.

Response (`200`):

```json
{
  "sub": "usuario",
  "exp": 1739999999
}
```

### `POST /logout`

Invalida cookie no cliente.

Response (`200`):

```json
{
  "message": "ok"
}
```

## Endpoints de Dashboard (Protegidos)

### `GET /api/user/dashboard`

Retorna o dashboard completo do usuário autenticado.

### `POST /api/user/dashboard`

Salva dashboard do usuário (merge com payload existente).

Payload mínimo:

```json
{
  "name": "Nome",
  "role": "Operador",
  "scenarios": [],
  "currentScenarioId": "default",
  "rsuByScenario": {}
}
```

Response (`200`):

```json
{
  "status": "ok",
  "message": "Dashboard salvo com sucesso"
}
```

### `POST /api/user/landfill/calc`

Executa cálculo de metano/RSU no backend.

Payload:

```json
{
  "rows": [],
  "config": {},
  "anoInicial": 2000,
  "anoFinal": 2044,
  "maxYear": 2060
}
```

Response (`200`):

- objeto com `status: "ok"`, séries totais, séries por cidade e parâmetros derivados (`doc`, `mcf`, `loTonPerTon`, `captacaoBiogasPct`, etc.). Cada linha anual traz `metanoTAno` (gerado) e `metanoRecuperadoTAno` (gerado × captação).

## Endpoint de JSON protegido

### `GET /api/json/{name}`

Lê arquivo JSON em `server/Dados`.

Exemplo:

- `GET /api/json/estados_municipios.json`
- `GET /api/json/PB_populacao_2000_2060.json`

Regras:

- apenas `GET`;
- exige autenticação;
- bloqueia path traversal (`..`, `/`, `\`).

## WebSocket

Endpoint: `/ws`

Mensagens:

- `{"type":"ping"}` -> `{"type":"pong","ts":...}`
- `{"type":"chat","text":"..."}` -> broadcast

## Exemplos cURL

Login:

```bash
curl -i -X POST http://localhost:7080/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Senha@123"}' \
  -c cookies.txt
```

Dashboard:

```bash
curl -i http://localhost:7080/api/user/dashboard \
  -b cookies.txt
```

Signup local:

```bash
curl -i -X POST http://localhost:7080/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"novo_usuario","password":"Senha@123"}'
```
