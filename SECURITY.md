# Security Policy

## Supported Versions

No momento, o suporte de segurança é voltado à versão em desenvolvimento principal deste repositório.

## Reporting a Vulnerability

Se você identificar uma vulnerabilidade:

1. Não publique em issue pública inicialmente.
2. Envie detalhes de reprodução, impacto e sugestão de mitigação.
3. Aguarde confirmação antes de divulgação pública.

Inclua no reporte:

- endpoint/fluxo afetado;
- severidade estimada;
- passos para reproduzir;
- evidências (logs, payloads, prints).

## Security Controls Already in Place

- autenticação JWT com validade temporal;
- cookie HttpOnly para sessão;
- restrição de cadastro (`/signup`) a localhost da máquina do servidor;
- filtro de autenticação (`AuthFilter`) nas rotas protegidas;
- validação básica de entrada em endpoints críticos.

## Recommended Hardening

- usar `JWT_SECRET` forte e rotacionável;
- aplicar HTTPS em toda a borda pública;
- ativar rate limit para login/signup;
- monitorar tentativas de autenticação inválida;
- criar rotina de backup dos arquivos em `server/Dados/users/`.
