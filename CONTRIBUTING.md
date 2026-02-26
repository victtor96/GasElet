# Contribuindo

Obrigado pelo interesse em contribuir com o Gaselet.

## Fluxo recomendado

1. Abra uma issue descrevendo problema ou melhoria.
2. Crie uma branch com escopo claro.
3. Faça commits pequenos e objetivos.
4. Garanta build local do frontend e backend.
5. Abra um Pull Request com contexto técnico e impacto.

## Padrões de código

- Frontend:
  - manter componentes legíveis e responsabilidades claras;
  - não quebrar responsividade;
  - preservar consistência visual.
- Backend:
  - manter validação de entrada e tratamento de erro;
  - evitar regressões em autenticação e persistência;
  - manter código compatível com C++17.

## Convenções de commit (sugestão)

- `feat:` nova funcionalidade
- `fix:` correção de bug
- `docs:` documentação
- `refactor:` refatoração sem mudança funcional
- `chore:` manutenção

Exemplo:

```text
feat(energy): add annual homes supplied chart for generator comparison
```

## Verificações mínimas antes do PR

- `cd client && npm run build`
- backend compila com CMake
- fluxos principais testados manualmente:
  - login/logout;
  - salvar cenário e atualizar página;
  - páginas Home/RSU/Charts/Energy.

## Escopo de PR

Evite PRs muito grandes.  
Prefira alterações pequenas, com descrição clara de:

- problema;
- solução;
- riscos;
- testes realizados.
