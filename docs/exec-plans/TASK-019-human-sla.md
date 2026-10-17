# TASK-019 — SLA humano

## Objetivo e escopo

Configurar SLA por tenant, agendar e executar alertas idempotentes, mostrar espera
na Inbox e comunicar mudanças pelo WebSocket existente. Sem TASK-020, WhatsApp,
IA, envio externo, dashboard, distribuição automática ou escalonamento de equipes.

## Decisões anteriores à implementação

- HumanSlaRule: uma configuração por tenant; first/second inteiros positivos,
  first < second; external opcional, obrigatório e > second se habilitado.
  internalAlertEnabled controla FIRST/SECOND; external é independente. Sem defaults
  de minutos no domínio. CRUD administrativo exige settings.manage.
- HumanSlaCycle: UUID por entrada em NEEDS_HUMAN com regra ativa; snapshot tipado
  dos tempos/flags para previsibilidade. Alterar tempos afeta ciclos novos; desativar
  regra encerra ciclos existentes e limpa nível, sem reiniciá-los ao reativar.
  Tenant sem regra segue handoff normalmente. Não iniciar retroativamente ciclos
  de conversas que já aguardavam antes de existir regra.
- handoffRequestedAt/relógio PostgreSQL inicia contagem; mensagens não reiniciam.
  Ciclo guarda requestedAt/endedAt/claimedAt para métricas e contexto histórico.
  Índice único parcial limita um ciclo aberto por conversa. Histórico de níveis
  fica no AuthEvent existente, sem duplicar tabela de alertas.
- Conversation recebe slaLevel (NONE/FIRST/SECOND/EXTERNAL). Só persiste mudanças
  de nível; contador usa timestamp. Claim encerra ciclo e zera nível na mesma
  transação; qualquer job antigo valida ciclo fechado/status/tenant antes de agir.
- HumanSlaJob é registro durável de agendamento (outbox específica), criado dentro
  da transação de handoff, unique ciclo/nível. Identidade BullMQ usa seu UUID;
  payload contém apenas tenantId/jobId. Sem fila por tenant nem IDs com ':' que
  BullMQ reserva. Dispatcher lê lotes de jobs pendentes por índice, não varre
  conversas; recupera crash entre commit/enqueue e perda de job no Redis.
- BullMQ é introduzido na infraestrutura backend compartilhada, com REDIS_URL
  obrigatório para executar o worker SLA, retry/backoff e logs sem credenciais.
  API pode servir REST sem Redis configurado; intenção permanece no PostgreSQL.
  Compose inclui Redis e configuração explícita para API/worker.
- Worker usa transação Serializable e o mesmo lock de Conversation do claim.
  Se claim vence, SKIP; se alerta vence, claim limpa em seguida. Retry e jobs
  concorrentes elevam nível somente uma vez com audit atômico. Jobs pendentes
  tornam-se processados/inválidos ao fechar ciclo, sem depender de remove Redis.
- Motor puro em packages/domain calcula nível e horários do preview. Worker
  atrasado calcula maior nível vencido e publica um único avanço, marcando níveis
  vencidos como processados. Não inventa datas de disparos omitidos: audit informa
  horário previsto/real e recuperação. Jobs futuros continuam programados.
- Worker retorna aviso mínimo depois do commit; QueueEvents do BullMQ o entrega
  à API, que usa RealtimeEvents/Gateway existentes. Novo tipo sla_updated apenas
  invalida REST (sem conteúdo/paciente). Claim/configuração também publicam após
  commit. Entrega visual é best-effort, REST/reconexão recupera estado persistido.
- Alerta EXTERNAL registra HUMAN_SLA_EXTERNAL_ALERT_REQUIRED; não marca envio,
  não coleta destinatário antecipadamente, não cria provider fictício.
- Preview administrativo usa os mesmos thresholds. UI usa nível retornado pelo
  backend e contador derivado de timestamp, sem repetir comparações de thresholds.

## Arquivos e sequência

1. Domínio de SLA/testes; schema/migration nova (sem alterar históricas).
2. Persistência de ciclo/jobs e processador transacional compartilhado backend.
3. API de regras/preview, integração handoff, projeções e bridge QueueEvents.
4. Worker BullMQ/dispatcher e configuração Redis/Docker.
5. Inbox contador/labels de alerta, atualizações e testes de frontend.
6. Testes de PostgreSQL + Redis reais, fake clock/domínio, concorrência, WebSocket.
7. Documentar contrato, comandos, inventário e resultados.

## Banco e riscos

FKs compostas tenant/conversation/cycle; UNIQUE tenant na configuração e
cycle/level nos jobs. Índices de outbox pendente, ciclos abertos e fila existente.
CHECKs de limites/flags e slaLevel somente em NEEDS_HUMAN. Sem copiar conteúdo clínico
para jobs/audit. API nunca recebe tenant para jobs nem endpoint público de execução.
Mudanças de configuração e workers podem concorrer: usar Serializable e retry.
Não confundir snapshot de tempos com regra global atual: desativação é revogação.
Redis não é fonte de verdade de estado. Operação requer worker e Redis disponíveis;
recovery preserva jobs sem bloquear handoff. Backlog pode atrasar alertas reais.

## Testes e aceite

Limites exatos/tempo futuro/flags/preview; DTOs; RBAC/tenant em CRUD; ciclos novos,
claim antes/entre níveis, jobs antigos, retry/outbox duplicados, recuperação tardia,
concorrência claim/alerta, regra desativada, alteração A não muda B, audit/métricas,
Redis/BullMQ reais e sockets isolados, payload mínimo, UI espera/nível/limpeza.

## Validação prevista

pnpm db:validate; pnpm db:migrate; pnpm lint; pnpm typecheck; pnpm test;
pnpm db:test (incluindo Redis/jobs); pnpm --filter @atendente/web test:e2e;
pnpm build; git diff --check. Revisar migration antes de aplicar.

## Rollback

Parar worker SLA e desabilitar regras; não apagar ciclos/audit. Reverter UI/API
preservando proteção de handoff. Preferir migration corretiva, não DROP de histórico.

## Resultados

Concluída em 2026-10-04. TASK-020 não iniciada.

- `pnpm db:validate`: aprovado.
- `pnpm db:migrate`: 20261004000000_human_sla aplicada localmente.
- `pnpm db:test`: migrations do zero/reaplicação/seed e Redis isolado aprovados;
  197 testes da API + 2 testes do banco, todos aprovados.
- `pnpm lint`: aprovado (8 tarefas).
- `pnpm typecheck`: aprovado (11 tarefas incluindo builds necessários).
- `pnpm test`: aprovado (75 testes: API 54, web 15, banco 3, worker 3).
- `pnpm --filter @atendente/web test:e2e`: aprovado (19 testes).
- `pnpm build`: aprovado (7 tarefas).
- `git diff --check`: aprovado.
- Redis local iniciado por `docker compose up -d redis`, healthy. Porta publicada
  6381, porque 6379 pertencia a outro serviço, preservado. `.env` local ignorado
  recebeu REDIS_URL/REDIS_PORT correspondentes; Compose API/worker usam DNS redis.
- Dependências instaladas: bullmq 6.3.11 e ioredis 6.0.0 em database;
  domain workspace em database/API. Instalação/lock e geração Prisma concluídas.
  BullMQ 6 exige driver Redis opcional explícito: corrigido após primeira execução.
  Fixture de login foi corrigida para não renovar/revogar a sessão do primeiro ator.
- Logs: `/tmp/task019-{lint,typecheck,test,build,e2e}.log`,
  `/tmp/task019-db-test-3.log`, `/tmp/task019-migrate.log`.

## Inventário criado

- `docs/exec-plans/TASK-019-human-sla.md`
- `packages/database/prisma/migrations/20261004000000_human_sla/migration.sql`
- `packages/domain/src/human-sla.ts`
- `packages/database/src/human-sla.ts`
- `packages/database/src/human-sla-queue.ts`
- `apps/api/src/human-sla/human-sla.dto.ts`
- `apps/api/src/human-sla/human-sla.repository.ts`
- `apps/api/src/human-sla/human-sla.service.ts`
- `apps/api/src/human-sla/human-sla.controller.ts`
- `apps/api/src/human-sla/human-sla.bridge.ts`
- `apps/api/src/human-sla/human-sla.module.ts`
- `apps/api/test/human-sla.test.ts`
- `apps/api/integration/human-sla.test.ts`
- `apps/web/lib/human-sla.ts`
- `apps/web/lib/use-wait-clock.ts`
- `apps/web/components/inbox/sla-indicator.tsx`
- `apps/web/test/human-sla.test.tsx`

## Inventário alterado nesta tarefa

- `packages/database/prisma/schema.prisma`
- `packages/database/package.json`
- `packages/database/src/index.ts`
- `packages/domain/src/index.ts`
- `apps/api/package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/conversations/conversation.repository.ts`
- `apps/api/src/conversations/conversation-access.ts`
- `apps/api/src/inbox/inbox.repository.ts`
- `apps/api/src/realtime/realtime.events.ts`
- `apps/worker/src/main.ts`
- `apps/web/lib/inbox.ts`
- `apps/web/lib/realtime.ts`
- `apps/web/components/inbox/conversation-list.tsx`
- `apps/web/components/inbox/handoff-controls.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/handoff.spec.ts`
- `scripts/test-database.mjs`
- `pnpm-lock.yaml`
- `compose.yaml`
- `.env.example` e `.env` local ignorado
- `README.md`
- `docs/architecture.md`
- `docs/conversations.md`
- `docs/domain-model.md`
- `docs/security.md`

## Cobertura e limitações finais

11 cenários de integração agrupam CRUD/RBAC/isolamento, sem regra, flags,
primeiro/segundo/externo, limites temporais, preview, histórico, métrica, claim
antes/entre níveis, SKIP em HUMAN/RESOLVED/CLOSED/AI, novos ciclos e jobs antigos,
repetição de ingresso/processamento, snapshot A/B, desativação, recuperação atrasada,
concorrência entre jobs e claim, outbox duplicado/recuperado, BullMQ delayed real,
QueueEvents e WebSocket A/B, limpeza em tempo real, FKs/constraints. 4 testes
unitários novos exercitam relógio falso, motor/preview/flags/DTO/conexão/payload.
Frontend inclui teste unitário e browser com relógio controlado, três níveis,
contador derivado e remoção no claim. Suítes anteriores continuam aprovadas.

Avisos visuais seguem best-effort: não há outbox de WebSocket nem envio externo.
A recuperação preserva operação no PostgreSQL; worker/Redis indisponíveis atrasam
alertas. Configurar mesma REDIS_URL para API/worker. Não há regra automática para
clínicas existentes, destinatário externo ou backfill de SLA. Retenção de histórico
PostgreSQL continua política operacional futura; dados não são excluídos aqui.
Não há pendência de validação. As imagens Docker de aplicações devem ser construídas
com o código atualizado para executar esta versão; build desta entrega foi local.
