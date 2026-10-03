# Changelog

Todas as mudanças relevantes deste projeto devem ser documentadas aqui.

O formato segue a ideia do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e versionamento semântico.

## [Unreleased]

### Added

- README profissional para apresentação em GitHub/LinkedIn.
- documentação técnica em `docs/API.md`, `docs/ARCHITECTURE.md` e `docs/DEPLOY.md`.
- arquivos de governança: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`.
- fallback de persistência local e flush explícito no logout para reduzir perda de estado.

### Changed

- reorganização da documentação principal do projeto.
- MCF segue a Tabela 3.1 do IPCC 2006 (1,0 / 0,8 / 0,4 / 0,6); rótulos antigos continuam aceitos.
- captação de biogás (`captacaoBiogasPct`) passa a reduzir o metano disponível para geração (`metanoRecuperadoTAno`).
- casas atendidas e comparação de geradores usam a energia gerada (limitada pela potência nominal).
- período padrão unificado em 2000–2060 em todas as telas; modelo do aterro centralizado em `client/src/utils/landfillModel.js`.

### Fixed

- decaimento de primeira ordem do metano usava o ano inicial do aterro em vez do ano de deposição, subestimando a produção.
- telas de Metano e Energia descartavam `gerenciamento`, fazendo o MCF ser sempre 1,0.
