# TASK-035 — MVP Release Candidate

## Objetivo

Validar a coerência do MVP entregue pelas TASKs 001–034, corrigindo apenas falhas
reprodutíveis que bloqueiem os critérios de aceite. Produzir evidências e
documentação de implantação; não iniciar trabalho pós-MVP.

## Baseline antes da implementação

- Branch: `main`.
- HEAD: `ea9ca687d0311f66ff05405ae27d8ca995062a2d`.
- Working tree: 76 entradas modificadas/não rastreadas antes da TASK-035, incluindo
  entregas de TASK-032/033/034. Estas alterações são preexistentes e devem ser
  preservadas; o relatório final separará arquivos novos desta tarefa.
- Node: `v22.22.2`; pnpm: `10.30.3` (compatível com `packageManager`).
- PostgreSQL/Redis de teste: imagens pinadas em `scripts/test-database.mjs` e
  `compose.yaml`: `postgres:17-bookworm` e `redis:7.4-alpine`; imagens locais
  disponíveis. TASK-034 já aplicou 35 migrations em PostgreSQL descartável.
- Migrations no início: 35 diretórios de migration, incluindo
  `20261018000000_plans_usage`.
- Baseline de TASK-034, sem alterações posteriores de código nesta sessão:
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:validate`, `pnpm db:test`,
  `pnpm --filter @atendente/web test:e2e`, `pnpm build`, `docker build` e
  `pnpm audit` passaram. A suíte DB aplicou e reaplicou migrations, seed duas
  vezes, 5 testes do pacote database e 303 integrações API. O browser E2E passou
  25 casos, com `ECONNREFUSED localhost:3001/realtime` porque não inicia API;
  portanto não comprova fluxo real WebSocket API+Web.
- Decisão prévia TASK-034: `BLOCKED FOR TASK-035` por evidência operacional ainda
  ausente, não por advisory CRITICAL/HIGH conhecido. `pnpm audit` ficou sem
  advisories após overrides de `deepmerge-ts` e `mysql2`.
- Pacotes seguem `0.0.0`; não há convenção de tags RC no Git. Não criar tag nem
  inventar versão.

## Escopo

- Revisar evidências da TASK-034, backlog e documentação funcional/técnica de
  segurança, tenancy, agenda, conversas, integrações, auditoria, dashboard,
  plataforma e planos.
- Executar novamente validações de lockfile, schema/migrations descartáveis,
  lint, typecheck, unit, integração, browser E2E, build, auditoria de dependências
  e scan de segredos/padrões perigosos.
- Mapear cenários críticos a testes concretos e distinguir integração simulada de
  validação com provedores reais.
- Criar checklist RC, checklist de implantação, known issues e release notes.
- Adicionar somente verificação de integridade ou teste E2E se houver lacuna
  local corrigível e necessária à decisão RC.

## Arquivos previstos

- `docs/exec-plans/TASK-035-mvp-release-candidate.md`.
- `docs/release/MVP-RC-CHECKLIST.md`.
- `docs/release/MVP-DEPLOYMENT-CHECKLIST.md`.
- `docs/release/MVP-KNOWN-ISSUES.md`.
- `docs/release/MVP-RELEASE-NOTES.md`.
- Eventuais testes/script de integridade e correções mínimas, somente se
  identificados por falha ou critério sem evidência local.

## Mudanças de banco

Nenhuma migration prevista. Todas as migrations serão exercitadas somente pelo
script de teste com PostgreSQL/Redis descartáveis. Não apontar comandos para o
banco de desenvolvimento/produção nem alterar volumes persistentes.

## Riscos e limites

- Testes com providers fake não provam credenciais, OAuth, callbacks, entrega ou
  sincronização em serviços reais.
- Execução local não prova branch protection/CI remota, restore externo cronometrado,
  RPO/RTO, deploy HTTPS/CSP, escala multi-instância ou incidentes em produção.
- Um teste de navegador que não inicia API não prova o fluxo conectado.
- Alterações pré-existentes no working tree dificultam atribuição; não descartar,
  formatar em massa ou sobrescrever arquivos fora do escopo.

## Validações

1. `pnpm install --frozen-lockfile`.
2. `pnpm db:validate` e `pnpm db:test` (migrations limpas/reaplicadas em serviços
   descartáveis).
3. `pnpm lint`, `pnpm typecheck`, `pnpm test`.
4. `pnpm --filter @atendente/web test:e2e`.
5. `pnpm build`.
6. `pnpm audit`, `git diff --check` e scan do working tree/histórico disponível.
7. Suítes de integração relevantes para agenda, conversa/IA/tools, webhooks,
   notificações, calendar, audit, analytics, plataforma e planos, registrando
   limitações de testes mockados.

## Critérios de aceite

- Cada requisito obrigatório tem PASS/FAIL/BLOCKED/N/A com evidência reproduzível.
- Nenhum blocker de segurança, isolamento, migrations, build ou fluxo principal é
  omitido ou mascarado.
- Checklist de implantação e rollback explicita configuração por serviço,
  migrations, saúde, providers, smoke test e limitações operacionais.
- Known issues contém somente pendências verificadas e severidade justificada.
- Decisão final explícita `MVP RC READY` ou `MVP RC BLOCKED`; READY só com todos os
  critérios definidos pelo backlog demonstrados.
- Nenhuma TASK adicional iniciada.

## Rollback

Não previsto para documentação. Qualquer correção de código deve ser pequena,
reversível e testada; sem migration. Preservar integralmente as mudanças que já
existiam no working tree antes desta tarefa.

## Resultado da validação

### Execução em 2026-10-18

- `pnpm install --frozen-lockfile`: passou, lockfile permaneceu igual.
- `pnpm db:validate`: passou.
- `pnpm db:test`: passou. PostgreSQL 17/Redis 7.4 descartáveis; 35 migrations
  aplicadas do zero, reapply sem pendências, seed duas vezes, 5 testes database e
  303 testes de integração API passaram. Nenhuma migração persistente foi aplicada.
- `pnpm lint`: passou (8 alvos); `pnpm typecheck`: passou (12 tarefas).
- `pnpm test`: passou, incluindo 161 testes API e os testes database/web/worker/
  domain existentes, sem falhas.
- `pnpm --filter @atendente/web test:e2e`: 25 passaram; chamadas do proxy
  `/realtime` registraram `ECONNREFUSED`, pois API não faz parte dessa suíte.
- `pnpm build`: 7 alvos passaram.
- `docker build -t atendente-task035-rc .`: passou. A imagem gerada executa como
  usuário `node`, mas é o Dockerfile de desenvolvimento e não é artefato de release.
- `pnpm audit`: nenhum advisory conhecido.
- Scan textual e `git diff --check`: sem segredo real encontrado e sem whitespace
  errors. Uma chave fake está explícita em teste; não há scanner dedicado/histórico.
- Prettier passou para os cinco documentos criados após ajustar as tabelas.
- Correções de código: nenhuma necessária; suites ficaram verdes. Mudanças desta
  tarefa são somente plano e documentação em `docs/release/`.
- Decisão: `MVP RC BLOCKED`, por acceptance E2E conectado ausente, validação de
  providers/deploy real e restore operacional pendentes. Itens e ações estão em
  `docs/release/MVP-KNOWN-ISSUES.md`.
