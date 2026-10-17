# TASK-028 — Worker e automações

## Objetivo

Executar confirmações, lembretes, retries funcionais, ações por ausência de resposta
e manutenção de HOLDs no app `apps/worker`, usando BullMQ/Redis apenas para transporte e
PostgreSQL como fonte de verdade. Reutilizar o resolvedor temporal da TASK-014 e a
outbox/MessagingProvider da TASK-020, sem implementar calendário externo ou TASK-029.

## Escopo

- Extrair o motor temporal puro de NotificationRule para pacote compartilhado e manter
  a API consumindo o mesmo contrato.
- Persistir `NotificationAttempt` por tenant, consulta, regra, ciclo e número da
  tentativa, com estados operacionais e referências à Message enviada.
- Criar fila BullMQ de automações de notificações com jobs de confirmação e lembrete,
  identidade determinística, payload mínimo, retries técnicos e retenção limitada.
- Calcular/upsertar tentativas futuras a partir de Appointment + NotificationRule;
  reconciliar um horizonte configurável no startup e periodicamente para recuperar
  perda/reinício do Redis.
- Revalidar no processamento tenant, consulta, regra, ciclo, status, horário atual,
  janela, antecedência, contato/canal e estado da tentativa antes de criar a Message.
- Persistir a Message na outbox existente e deixar o worker de entrega chamar o
  `MessagingProvider`; vincular a tentativa à mesma Message para impedir duplicidade.
- Agendar retry funcional por `resolveRetrySchedule`, separado dos retries técnicos do
  BullMQ, e concluir o ciclo conforme `actionIfNoResponse`.
- Reutilizar a limpeza em batch de HOLDs existente, com paginação/índice e execução
  periódica idempotente.
- Adicionar logs estruturados, contadores operacionais básicos e configuração de
  concorrência, reconciliation e retenção.

## Decisões técnicas

- A fila será `appointment-notifications`, com job names
  `notification:confirmation` e `notification:reminder`. Não haverá fila por tenant.
- `cycleKey` será uma impressão determinística dos dados que tornam o agendamento
  vigente: Appointment (id e startAt) e regra (id, updatedAt e campos temporais).
  Mudanças de estado são revalidadas diretamente e não alteram a identidade do ciclo;
  remarcação ou mudança da regra gera outro ciclo, e o job antigo falha fechado ao
  comparar novamente a impressão.
- `jobId` será `notification-<tenant>-<appointment>-<rule>-<cycle>-<attempt>` e a
  unique constraint equivalente no banco será a barreira de idempotência entre
  processos. O payload conterá somente IDs, cycleKey, attemptNumber e correlationId.
- CONFIRMATION será elegível apenas para `PENDING_CONFIRMATION`. REMINDER será elegível
  para `PENDING_CONFIRMATION` e `CONFIRMED`; nenhum tipo será enviado para estados
  encerrados, `CHECKED_IN`, `NO_SHOW` ou `RESCHEDULED`.
- `NotificationAttempt` representa tentativa funcional. Retry técnico reutiliza o
  mesmo registro e a mesma Message/outbox; falha incerta segue a política da TASK-020
  e não provoca reenvio cego.
- O job de automação cria a Message `PENDING` antes do envio e termina quando a intenção
  está na outbox. O processor de entrega existente chama `MessagingProvider`; a
  reconciliação da tentativa observa o estado da Message e promove SENT/FAILED sem
  repetir a intenção.
- O worker revalida atraso contra o mesmo motor. Se o instante atual ainda estiver na
  janela e respeitar a antecedência, pode executar; fora disso o ciclo é reagendado
  somente quando o resolvedor produzir um próximo instante válido, ou encerrado como
  SKIPPED. Horários calculados são instantes UTC; horário local usa
  `Unit.timezoneOverride ?? Tenant.timezone`.
- `maxAttempts` inclui a tentativa inicial. Retry funcional só existe para
  CONFIRMATION e usa exatamente `resolveRetrySchedule`.
- `NONE` encerra sem mutação. `MARK_UNCONFIRMED` encerra com resultado operacional no
  attempt, sem criar status de Appointment. `NEEDS_HUMAN` reutiliza o estado/conversa
  existente quando houver conversa do mesmo contato e registra a mutação/auditoria de
  forma idempotente. `CANCEL_APPOINTMENT` será registrado como não executado porque a
  política atual não autoriza cancelamento automático; não haverá UPDATE direto.
- Reconciliation considera somente consultas futuras dentro de horizonte configurável,
  em lotes, e faz upsert no PostgreSQL antes de enfileirar. Redis vazio é recuperável.
- HOLD continuará com sweep batch; slot já ignora HOLD vencido independentemente do
  cleanup. O worker não cria uma segunda fonte de expiração.
- Regras alteradas são percebidas pelo novo cycleKey/reconciliation; jobs antigos são
  marcados CANCELLED/SKIPPED na execução. Remarcação cria nova Appointment e invalida
  naturalmente o ciclo da original.
- Completed jobs terão retenção limitada; failed jobs serão preservados por uma janela
  maior. Logs serão JSON e nunca conterão texto da mensagem, telefone, token ou segredo.

## Arquivos afetados

- `packages/domain/src`: motor temporal compartilhado.
- `packages/database/prisma/schema.prisma` e nova migration: tentativas, relações,
  constraints e índices.
- `packages/database/src`: fila, scheduling, processing, reconciliation e integração
  com a outbox existente.
- `apps/api/src/notifications`: reexport/import do motor compartilhado.
- Pontos de criação/alteração de Appointment e NotificationRule, somente para despacho
  pós-commit quando necessário; reconciliation permanece a garantia de recuperação.
- `apps/worker/src`: bootstrap, lifecycle, concorrência, dispatchers e observabilidade.
- `.env.example`, `compose.yaml`, documentação de agenda/arquitetura/integrações.
- Testes unitários e de integração de database/API/worker.

## Mudanças de banco

- Enum `NotificationAttemptStatus` com SCHEDULED, PROCESSING, SENT, SKIPPED, FAILED e
  CANCELLED.
- Tabela `notification_attempts` com tenant, appointment, rule, type, cycleKey,
  attemptNumber, scheduled/started/sent timestamps, Message/provider/error/result.
- FKs compostas preservando tenant em Appointment, NotificationRule e Message.
- Unique `(tenant_id, appointment_id, notification_rule_id, cycle_key,
attempt_number)` e índices de tenant/recurso/status/scheduledAt/createdAt.
- Reutilizar/revisar índice `(status, expires_at, tenant_id)` de AppointmentHold e
  índices existentes de Appointment/NotificationRule; criar somente o que faltar.
- Migration aditiva; nenhuma migration histórica será alterada.

## Riscos

- A API externa não oferece exactly-once absoluto. O desenho prioriza Message/outbox,
  claim SQL e resultado incerto para evitar duplicação silenciosa.
- Uma consulta sem Contact/canal/Integration utilizável não será enviada; a tentativa
  ficará SKIPPED/FAILED com código seguro.
- Não há relação direta Appointment→Conversation. NEEDS_HUMAN só pode atuar quando uma
  conversa inequívoca do Contact existe; caso contrário registra alerta operacional.
- A mudança de regra pode exigir reconciliation até o próximo intervalo; execução de
  job antigo ainda revalida e não envia dados obsoletos.

## Testes

- Motor temporal compartilhado, inclusive terça 08:00/offset 4h/PREVIOUS → segunda
  20:00, weekdays, mínimo, policies, Unit timezone e UTC.
- Scheduling CONFIRMATION/REMINDER, regra inativa/ausente, estados elegíveis, mudança,
  cancelamento, remarcação e horizon.
- Execução consulta PostgreSQL, persiste Message/outbox, usa integração existente,
  trata falta de canal e falha do provider.
- Retry técnico versus funcional, maxAttempts, resposta já confirmada, janela/mínimo e
  no-response.
- JobId/constraint, repetição e concorrência de dois workers.
- Cross-tenant e payload mínimo, logs sanitizados.
- Redis vazio/restart/reconciliation idempotente.
- HOLD ACTIVE vencido, válido, CONSUMED, RELEASED e repetição.
- Dois cenários end-to-end exigidos: confirmação com retry ajustado e remarcação após
  scheduling.

## Comandos de validação

```text
pnpm --filter @atendente/database exec prisma format
pnpm --filter @atendente/database generate
pnpm db:validate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm --filter @atendente/worker test
pnpm build
pnpm format:check
git diff --check
```

## Critérios de aceite

- Jobs futuros são reconstruíveis do PostgreSQL, determinísticos e não duplicam envio.
- Worker nunca usa payload como verdade nem calcula regra temporal própria.
- Confirmação/lembrete/retry respeitam regra, tenant, timezone, estado e antecedência.
- Mensagem é persistida antes da chamada externa e enviada somente pelo provider.
- HOLD cleanup continua idempotente e preserva CONSUMED/RELEASED.
- Suites, migrations, lint, typecheck e build passam sem implementar TASK-029.

## Rollback

Desativar o dispatcher/processor por configuração preserva Appointments, Messages e
tentativas. Remover jobs Redis é seguro porque reconciliation depende do PostgreSQL.
Uma migration compensatória poderá desativar/remover a tabela apenas depois que nenhum
worker/API a utilizar; histórico não será apagado durante rollback operacional.

## Resultado da implementação

- O motor temporal passou a ser compartilhado por API e worker em
  `packages/domain`, sem uma segunda implementação das regras de janela, weekdays,
  antecedência ou timezone.
- `NotificationAttempt` tornou o PostgreSQL o ledger de scheduling, execução, outbox,
  retry funcional e resultado. A associação com `Message` substitui metadata no texto,
  preservando a constraint que exige `metadata IS NULL` para mensagens `TEXT`.
- O worker reconcilia consultas futuras a cada 30 segundos, reconstrói jobs ausentes no
  Redis, processa com concorrência configurável e faz shutdown aguardando dispatchers,
  workers, filas, banco e aplicação.
- O envio permanece no pipeline de outbox da TASK-020. O job apenas persiste a Message;
  o `MessagingProvider` continua sendo o único ponto de chamada externa.
- A migration foi validada do zero e reaplicada; a suíte integrada cobre concorrência de
  processors, deduplicação, retry funcional, cross-tenant, recuperação de Redis vazio e
  constraints físicas. Resultados finais dos comandos são registrados na entrega da task.
- Validação final: migration aplicada no banco local; 27 migrations aplicadas do zero e
  reaplicação idempotente no banco efêmero; 276 testes integrados aprovados; testes
  padrão aprovados (API 140, worker 6, database 3 e web 18); lint 8/8, typecheck 11/11,
  build 7/7, Prisma validate, Prettier e `git diff --check` aprovados.
