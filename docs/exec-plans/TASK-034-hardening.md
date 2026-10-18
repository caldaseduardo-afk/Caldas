# TASK-034 — Hardening

## Objetivo

Fazer uma revisão transversal de segurança e resiliência para preparar uma decisão
de release candidate, corrigindo falhas verificáveis sem adicionar funcionalidades
de produto. O resultado deve registrar evidências, riscos e passos operacionais;
esta tarefa não declara produção pronta por inferência.

## Escopo

- Revisar auth, RBAC, tenant scoping, API/DTOs, frontend, IA/Tool Gateway,
  WhatsApp, Google OAuth/Calendar, auditoria, workers/BullMQ, Redis e health.
- Corrigir problemas concretos dentro da arquitetura atual e adicionar testes de
  segurança/resiliência proporcionais aos achados.
- Criar checklist de prontidão, runbook de backup/restore e runbook de incidentes.
- Executar validações de código, testes, migrations de validação, build e auditoria
  de dependências; classificar itens sem evidência como FAIL ou DEFERRED.

## Threat model: ameaça → mitigação a verificar

| Ameaça                                                       | Mitigação e evidência a verificar                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Roubo de credencial, brute force, fixation e sessão obsoleta | scrypt, sessões opacas revogáveis, throttle persistente, cookie e revalidação de usuário/status; testes auth.                   |
| CSRF, XSS e open redirect                                    | Origin/cookie SameSite, CSP/headers, React escaping, sanitização Markdown/KB e allowlist de redirects; testes web.              |
| SQL/command injection e SSRF                                 | Prisma parametrizado, busca de APIs raw/shell/fetch, destinos externos fixos e redirects desabilitados; revisão por ocorrência. |
| Acesso cross-tenant e escalada horizontal/vertical           | tenant na query, revalidação RBAC/platform scope e IDs conhecidos; testes de integração/repositories.                           |
| Prompt injection e abuso de ferramentas                      | allowlist de tools, schemas estritos, limite de chamadas, contexto mínimo e autorização de backend; testes adversariais.        |
| Spoof/replay/duplicação de webhook e payload excessivo       | HMAC, limite de corpo, validação de schema e chave única idempotente; testes HTTP.                                              |
| Mídia maliciosa e path traversal                             | verificar se há ingestão/download/upload; se ausente, registrar DEFERRED e não afirmar proteção de storage.                     |
| OAuth token theft e callback malicioso                       | state, redirect URI fixa, escopos mínimos e armazenamento server-side; testes e inspeção do fluxo.                              |
| Secrets/log leakage e dados pessoais                         | `.env.example`, scan do working tree, sanitizadores, erros seguros e logs; não reescrever histórico automaticamente.            |
| Dependências vulneráveis e supply chain                      | lockfile frozen, audit do pnpm e CI; revisar advisories antes de atualizar.                                                     |
| DoS, abuso por tenant e payload/query excessivos             | throttles e limites por endpoint, tenant, paginação e tamanho; verificar distribuição multi-instância.                          |
| Queue poisoning, duplicação e crash                          | tipos allowlisted, payload mínimo, idempotência/ledger, retry limitado, retenção e reconciliação; testes com Redis/BullMQ.      |
| Redis/DB/provider indisponível e shutdown                    | liveness/readiness, timeouts/retries finitos, reconciliação e fechamento SIGTERM; testes disponíveis.                           |
| Cache indevido e permissões stale                            | procurar cache de recursos/permissões; acesso revalida membership e sessão no banco.                                            |
| Docker/root/secret baked e configuração de produção          | inspecionar arquivos de container/compose, env validation e flags; marcar N/A se não houver artefato.                           |

## Arquivos e áreas afetadas

- Novo plano: `docs/exec-plans/TASK-034-hardening.md` (este arquivo).
- Novos documentos operacionais: `docs/production-readiness-checklist.md`,
  `docs/runbooks/backup-restore.md`, `docs/runbooks/incident-response.md`.
- Implementação: `apps/api/src/bootstrap.ts`, `health.controller.ts`,
  `app.module.ts`, `apps/api/test/bootstrap.test.ts`,
  `apps/api/integration/appointments.test.ts`,
  `apps/web/next.config.mjs`, `apps/web/e2e/security-headers.spec.ts`,
  `Dockerfile`, `package.json` e `pnpm-lock.yaml`.
- Decisões/gaps: `docs/security.md` e o checklist de prontidão.

## Mudanças de banco

Nenhuma prevista. A validação pode executar migrations em banco de teste isolado;
migrations históricas e dados locais não serão alterados. Se surgir necessidade de
schema, ela será reavaliada e justificada antes da implementação.

## Testes e validações

- Procurar padrões de risco (raw SQL unsafe, shell/eval, HTML cru, redirects,
  fetch controlado, flags de bypass e segredos) e revisar cada ocorrência real.
- Executar Prisma validate e migrations de teste, lint, typecheck, testes unitários,
  integração/E2E disponíveis e build de produção.
- Executar `pnpm audit` e classificar achados por severidade/exposição.
- Mapear os oito cenários E2E mandatórios (cross-tenant Appointment, prompt
  injection, webhook spoof, outage de IA, perda de Redis/reconciliation, vazamento
  de secrets, rate abuse e workers duplicados/shutdown) para testes existentes ou
  novos; cenários sem ambiente/teste confiável ficam explicitamente DEFERRED.
- Checklist exige caminho/arquivo/teste/comando como evidência para PASS.

## Riscos

- O repositório pode não ter infraestrutura de produção (Dockerfile, CI, storage,
  deploy ou secret manager); documentação não substitui a validação operacional.
- Dependências podem ter advisories sem correção segura compatível com a stack.
- Histórico Git não será reescrito em resposta a possível secret; qualquer segredo
  real encontrado exige rotação operacional imediata.
- Testes locais não provam comportamento em múltiplas instâncias, provedor real,
  backup externo ou disaster recovery de produção.

## Critérios de aceite

1. Plano e threat model antecedem alterações de código.
2. Achados concretos corrigidos ou registrados com severidade, exposição e próximo
   passo; sem declarar cobertura sem evidência.
3. Checklist, backup/restore e incident response publicados.
4. Testes de segurança existentes/normais passam e lacunas de cenários obrigatórios
   ficam visíveis.
5. Prisma validate, lint, typecheck, testes aplicáveis, audit e build têm resultado
   reportado.
6. Classificação final explícita: `READY FOR TASK-035` somente com evidência
   suficiente; caso contrário `BLOCKED FOR TASK-035` com razões objetivas.
7. Nenhum trabalho de TASK-035 iniciado.

## Achados e decisões durante a execução

- O audit inicial apontou `deepmerge-ts@7.1.5` (HIGH) e `mysql2@3.15.3`
  (HIGH/MODERATE) no grafo transitivo de Prisma. Foram fixados overrides para
  `deepmerge-ts@8.0.2` e `mysql2@3.23.1`; Prisma PostgreSQL, geração e testes
  serão revalidados. `mysql2` não é driver ativo, mas o lockfile distribuía versões
  vulneráveis.
- API não possuía headers CSP/frame/nosniff/referrer/permissions completos e health
  era apenas `/health {status: ok}`. Foram adicionados headers, liveness e readiness.
  Readiness verifica PostgreSQL e Redis porque Redis é obrigatório para rate limiting
  distribuído em produção; provedores externos permanecem degradáveis.
- Login já tinha throttle persistente. Para API geral, foi adicionado limiter
  Redis atômico com escopo IP e orçamento tenant/plataforma; endpoints caros e
  webhook recebem políticas próprias. Produção exige Redis e falha fechado. O teste
  de integração confirma o isolamento entre tenants, mas ainda não simula duas
  instâncias da API contra Redis real.
- `Dockerfile` é exclusivamente o ambiente de desenvolvimento usado por
  `compose.yaml`; alterado para usuário não-root. Imagem de produção multi-stage
  permanece adiada. Foi criado workflow CI; execução remota e branch protection
  seguem sem evidência até a branch ser publicada.
- A primeira validação executou `pnpm test` em paralelo com `pnpm db:test`, e os
  dois fluxos geraram Prisma Client ao mesmo tempo (TS6053 em `prismaNamespace.ts`).
  A execução final sequencial de `pnpm test` e `pnpm db:test` passou; o workflow CI
  mantém as etapas sequenciais.

## Rollback

Não há migration prevista. Mudanças de código são revertíveis por arquivo e devem
ser isoladas. Documentos operacionais podem permanecer mesmo se uma correção de
código for revertida, desde que descrevam corretamente o estado resultante. Manter
inalteradas as mudanças locais anteriores à TASK-034.

## Evidências de validação

- `pnpm db:validate`: passou; schema Prisma válido.
- `pnpm lint`, `pnpm typecheck` e `pnpm test`: passaram. A API executou 161 testes
  unitários; a suíte Turbo concluiu os oito pacotes.
- `pnpm db:test`: passou; aplicou as 35 migrations em PostgreSQL descartável,
  reaplicou sem pendências, executou seed duas vezes, cinco testes do pacote de
  banco e 303 integrações de API.
- `pnpm --filter @atendente/web test:e2e`: 25 testes passaram. O Next registrou
  `ECONNREFUSED localhost:3001/realtime` porque a API não é iniciada por essa suíte;
  os mocks de navegador não provam E2E conectado API+WebSocket.
- `pnpm build`: passou nos sete pacotes/targets de build; `docker build` também
  concluiu. A imagem avaliada é a de desenvolvimento, executada sem root.
- `pnpm audit`: nenhum advisory conhecido após os overrides `deepmerge-ts@8.0.2`
  e `mysql2@3.23.1`. `git diff --check` passou. Scan de padrões não encontrou
  raw SQL unsafe, HTML cru, segredos reais ou bypasses de tenant/auth.
- Nenhuma migration foi criada por TASK-034.

Decisão: `BLOCKED FOR TASK-035`. Ainda faltam CI remota/branch protection, teste
de restore real e cronômetro de RPO/RTO, logger/redaction uniforme, cenário integrado
de outage/recovery/shutdown, validação da CSP em domínio real e integração OAuth
com credenciais/provider em ambiente operacional. Consulte o checklist para a
evidência por área; não é uma declaração de produção pronta.
