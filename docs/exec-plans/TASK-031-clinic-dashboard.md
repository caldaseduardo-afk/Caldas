# TASK-031 — Dashboard da clínica

## Objetivo e escopo
Dashboard operacional `/dashboard` por tenant, com API agregada, agenda, conversas,
SLA, conversão, origens, séries diárias e rankings. Não iniciar TASK-032.

## Plano e arquivos
1. Criar módulo `apps/api/src/analytics` (DTO, período/fórmulas, repository, service,
   controller/module), contrato em packages/types e registro no AppModule.
2. Reutilizar analytics.view (CLINIC_ADMIN), contexto autenticado e autorização
   dentro de transação de leitura RepeatableRead; toda query agrega por tenant.
3. Criar dashboard/componentes/styles, proxy GET e navegação em apps/web.
4. Adicionar testes unitários, integração HTTP/PostgreSQL e frontend/browser.
5. Registrar fórmulas em docs/dashboard.md e executar verificações completas.

## Decisões técnicas
- Endpoint consolidado GET /analytics/dashboard; GET /analytics/dashboard/options
  paginado e pesquisável fornece nomes/IDs autorizados para filtros, sem pacientes.
- Períodos TODAY, LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH, CUSTOM;
  datas civis inclusivas, query UTC semiaberta [início, dia seguinte ao fim).
  Máximo 366 dias. Timezone Unit.timezoneOverride ou Tenant.timezone; mesmo timezone
  para todas as seções, sem timezone vindo do navegador. PostgreSQL AT TIME ZONE
  resolve limites civis/DST; agrupamento também usa o mesmo timezone IANA.
- Agenda por start_at; exclui RESCHEDULED. Confirmadas = CONFIRMED/CHECKED_IN/COMPLETED;
  taxa confirmação divide por não canceladas; cancelamento divide pelo total;
  no-show divide por COMPLETED + NO_SHOW com start_at <= agora. Zero denom = 0%.
- Conversas do período = DISTINCT Conversation com Message no intervalo. Série diária
  mede conversas distintas naquele dia (não somável entre dias), mensagens AI/USER e
  handoffs solicitados. Estados atuais e SLA são seção “Agora”, sem filtro temporal.
- Unit/Service/Provider afetam apenas agenda/origens/rankings. Seções de atendimento
  e conversão abrangem a clínica toda, no timezone selecionado, claramente rotuladas.
- SLA atual usa slaLevel persistido pelo motor existente, sem inventar limites.
  Média = claimed_at - requested_at dos ciclos assumidos no período. Ciclos sem
  claimed_at não entram; handoffs sem regra SLA não possuem ciclo e ficam fora.
  Violações = ciclos distintos com alerta real auditado no período, não jobs processados.
- Workflow é reutilizado, logo createdAt/estado atual não preservam sessões anteriores.
  Conversão usa eventos STARTED de SCHEDULING no período e COMPLETED antes do próximo
  STARTED do mesmo workflow, com Appointment WHATSAPP_AI real do mesmo tenant.
  Cada início conta no máximo uma vez. Ausência de tipo em evento legado significa
  SCHEDULING (tipo original antes da TASK-025). Sem funil inventado por palavras.
- SQL parametrizado via Prisma para agregações condicionais, datas locais, DISTINCT e
  janelas históricas; não carregar entidades transacionais na memória nem chamar IA.
  Número fixo de consultas, ranking top 5 por dimensão; sem cache/materialized view.
- Gráficos SVG acessíveis sem nova biblioteca (não há biblioteca de gráficos instalada).
  Atualização manual preserva filtros; API não gera AuditLog de visualização.

## Banco e índices
Migration aditiva para índices tenant/start_at em Appointment, tenant/created_at em
Message, tenant/claimed_at em HumanSlaCycle. Migration adicional cria
AuthEvent(tenant_id,resource_id,type,created_at,id) após revisão da consulta histórica;
não modifica a primeira migration já aplicada. Reutilizar índices existentes de status,
recurso/ação auditada e tenant/relações. Sem novas entidades ou alterações históricas.

## Riscos e critérios de aceite
Datas DST e bordas devem ter testes. Nunca expor conteúdo de mensagens ou pacientes.
Snapshot garante consistência entre seções; revogação é revalidada no acesso ao tenant.
Histórico depende de eventos/ciclos existentes; lacunas anteriores não serão inferidas.
Fixture obrigatório: 6 confirmadas, 2 canceladas, 1 no-show, 1 remarcada = total 9;
3 IA, 2 humano, 1 precisa humano, 1 espera; ciclos 2/4/6 min = média 240 segundos;
dados adicionais do tenant B não alteram nenhum indicador de A.

## Validação
`pnpm db:validate`, `pnpm db:migrate`, `pnpm db:test`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm --filter @atendente/web exec playwright test dashboard.spec.ts`,
`pnpm build`, `git diff --check`. Testes de fórmulas, DST, limites, RBAC, filtros,
isolamento, séries, origens, ciclos repetidos e workflows históricos.

## Rollback
Remover rota/módulo/navegação novos. Índices aditivos podem permanecer ou ser removidos
por migration posterior revisada. Nenhuma alteração de dados de negócio necessária.

## Inventário final da implementação

Criados:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.dto.ts`
- `apps/api/src/analytics/analytics.metrics.ts`
- `apps/api/src/analytics/analytics.module.ts`
- `apps/api/src/analytics/analytics.repository.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `apps/api/test/analytics.test.ts`
- `apps/api/integration/analytics.test.ts`
- `packages/types/src/dashboard.ts`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/dashboard/dashboard.css`
- `apps/web/components/dashboard/dashboard.tsx`
- `apps/web/test/dashboard-fixture.ts`
- `apps/web/test/dashboard.test.tsx`
- `apps/web/e2e/dashboard.spec.ts`
- `packages/database/prisma/migrations/20261015000000_clinic_dashboard/migration.sql`
- `packages/database/prisma/migrations/20261015010000_dashboard_workflow_index/migration.sql`
- `docs/dashboard.md`
- Este plano.

Alterados nesta tarefa:
- `apps/api/src/app.module.ts` (registro do módulo).
- `apps/api/package.json`, `apps/web/package.json`, `pnpm-lock.yaml` (dependência
  local de tipos compartilhados; sem biblioteca externa nova).
- `packages/types/src/index.ts` (exports dos contratos).
- `packages/database/prisma/schema.prisma` (somente índices aditivos).
- `apps/web/app/page.tsx` e `apps/web/lib/proxy.ts` (navegação e GET permitido).
- `scripts/test-database.mjs` (compilar tipos compartilhados antes da integração API,
  também em checkout limpo).
- `docs/architecture.md` e `docs/product-spec.md` (referência às fórmulas).

As alterações anteriores no working tree foram preservadas; o inventário acima
se refere apenas à TASK-031. Nenhum modelo de negócio, enum, concessão RBAC ou
permissão nova: analytics.view e CLINIC_ADMIN já existiam.

## Validação — 2026-10-16

- Schema válido em `pnpm db:validate`; ambas as migrations aplicadas localmente por
  `pnpm db:migrate`, sem alteração de migrations anteriores.
- `pnpm lint`: 8 tarefas aprovadas; `pnpm typecheck`: 12 tarefas aprovadas.
- `pnpm test`: 150 testes API, 21 web, 6 worker e 6 database aprovados (183 total).
- `pnpm --filter @atendente/web exec playwright test dashboard.spec.ts`: 2 testes
  aprovados. Cobrem 7/30 dias, unidade, refresh/filtros, cards/gráfico/ranking,
  loading, vazio, erro e 403. Viewports 1366 e 1024 sem overflow horizontal.
- Screenshot `/tmp/task031-dashboard.png` inspecionado visualmente. Browser usa
  respostas de fixture interceptadas exclusivamente nos testes; integração HTTP
  usa PostgreSQL real e dados de duas clínicas. Produção não contém números mockados.
- Cenário HTTP obrigatório passou: total 9 (6 CONFIRMED, 2 CANCELLED, 1 NO_SHOW;
  RESCHEDULED excluído), estados 3 IA/2 humano/1 precisa humano/1 espera, média 240s.
  Dados adicionais do tenant B não alteram nenhum resultado de A.
- Fórmulas, bordas UTC, DST 23h/25h, meia-noite inexistente, isolamento, RBAC,
  revogação, ranking top 5, paginação, conversas distintas e ciclos repetidos cobertos.

Limitações deliberadas: sem cache, comparação anterior, funil não comprovável ou
métricas globais. Média histórica limitada a ciclos SLA existentes; conversão depende
da trilha STARTED/COMPLETED. Eventos antigos ausentes não são reconstruídos. Taxa de
no-show usa somente desfechos COMPLETED/NO_SHOW passados, não toda agenda passada.

Validação final concluída:
- `pnpm db:test`: 5 testes database + 293 testes de integração API aprovados;
  32 migrations do zero, reaplicação e seed aprovados. Inclui todos os testes novos
  e regressão dos módulos existentes. Nenhuma falha ou teste ignorado.
- `pnpm build`: 7 tarefas aprovadas, incluindo `/dashboard` no build Next.js.
- `git diff --check`: aprovado.
- TASK-031 concluída; TASK-032 não iniciada.
