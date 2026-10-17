# TASK-014 — Notification Rules

## Objetivo e escopo

Persistir configuração de CONFIRMATION/REMINDER por tenant e calcular horários
iniciais/retries com janela, dias, timezone e decisões estruturadas. Sem enviar
mensagens, jobs, worker novo, confirmação por resposta, cancelamento ou TASK-015.
Preservar todas as alterações anteriores do workspace.

## Decisões técnicas

- NotificationRule relacional com campos solicitados em camelCase/@map snake_case;
  horários TIME(0) locais, precisão de minuto; timestamps TIMESTAMPTZ UTC.
  allowedWeekdays usa array PostgreSQL do enum Weekday existente, não JSON.
  API normaliza dias repetidos e ordena na ordem semanal; array deve ter 1–7 dias.
- Múltiplas regras inclusive do mesmo type coexistem e calculam independentemente.
  Sem unique tenant/type, prioridade, deduplicação de disparos ou nome obrigatório.
- Offset/minimum inteiros não negativos até 2147483647 (Int PostgreSQL); retryAfter
  nulo quando desabilitado ou positivo; habilitado exige valor positivo. maxAttempts
  inteiro >=1, total de tentativas incluindo a inicial; default 1. active default true,
  retryEnabled false, retryAfterMinutes null, minimum 0, actionIfNoResponse NONE.
  Janela exige início < fim, sem atravessar meia-noite. Fim é INCLUSIVO para satisfazer
  o cenário obrigatório que agenda exatamente às 20:00. Não usar regra [start,end)
  de ocupação da agenda para instantes de comunicação.
- CONFIRMATION espera resposta; REMINDER é informativo. Esta camada calcula apenas
  tempos; campos de retry/ação são configuração, sem inferir resposta nem executar
  ação. NONE/MARK_UNCONFIRMED/NEEDS_HUMAN/CANCEL_APPOINTMENT são intenções persistidas.
- Retry recebe número da tentativa desejada (2 é primeiro retry); <=1 inválido;
  > maxAttempts resulta SKIP. Desabilitado resulta SKIP. Reutiliza o resolvedor comum.
  > PREVIOUS pode antecipar em relação ao alvo teórico, mas nunca repetir/anteceder
  > previousAttemptAt; nesse caso SKIP/NON_FORWARD_RETRY, sem troca implícita de política.

## Motor temporal e timezone

Funções puras resolveNotificationSchedule/resolveRetrySchedule centralizadas no módulo
backend, sem Prisma, relógio global, browser ou offset fixo. Recebem Date absoluto,
timezone efetivo e regra. Retornam decision, scheduledAt ISO UTC ou null, reason.
Alvo inicial = início - offset; retry = previousAttemptAt + retryAfterMinutes,
ambos minutos decorridos. Validar configuração inclusive em chamadas internas.

Resolver via Intl.DateTimeFormat IANA (mesma API usada na TASK-012). Examinar instantes
UTC com passo de minuto, formatando dia/hora local. Se alvo permitido, manter. Fora:
SKIP; PREVIOUS procura primeiro instante permitido anterior; NEXT posterior. Janela
fechada [start,end] e weekday local; dias proibidos são tratados como janela fechada
integralmente. Limite 9*1440 passos cobre semana e transições DST/data civil; sem
configuração válida ou candidato, retornar SKIP com motivo. Instantes inexistentes
em DST nunca são inventados; em horas repetidas escolher o instante real mais próximo
na direção solicitada. Intl formatter único por resolução, não por iteração.

Após resolução, candidato deve ser estritamente anterior à consulta, mesmo minimum=0;
antecedência >=minimum (igualdade permitida). Regra inativa resulta SKIP. Instantes
fora da precisão de minuto ou inválidos resultam SKIP/INVALID_INPUT. Não descartar
horários históricos por Date.now: cálculo/preview é teórico determinístico; executor
futuro deverá revalidar atualidade, resposta/estado e impedir duplicação antes de envio.

## API, autorização e persistência

Módulo notifications com DTO/controller/service/repository e motor. settings.manage
para CRUD/listas/preview; cálculo por Appointment exige adicionalmente appointment.view
+patient.view. Services revalidam; repositories filtram tenant e autorização no SQL.
Escritas Serializable com auditoria atômica NOTIFICATION_RULE_CREATED/UPDATED; sem
DELETE, PATCH active preserva histórico. PATCH valida estado final dentro da transação.

POST /notification-rules; GET /notification-rules (?type,active);
GET /notification-rules/:id; PATCH /notification-rules/:id;
POST /notification-rules/:id/preview: appointmentStart, unitId opcional, previousAttemptAt
+attemptNumber opcionais em par (retry). Timezone vem do Tenant/Unit, nunca payload.
POST /notification-rules/:id/resolve: appointmentId e retry opcional; carrega consulta
no tenant, usa Unit.timezoneOverride ?? Tenant.timezone; consulta encerrada retorna
SKIP/APPOINTMENT_INACTIVE. Não retornar paciente/notes, timestamps internos ou tenantId.
Preview e cálculo por consulta chamam exatamente o mesmo motor.

## Banco e arquivos afetados

Migration aditiva nova, enums NotificationType, OutsideWindowPolicy, NoResponseAction,
NotificationRule, relação reversa Tenant, eventos AuthEventType. FK tenant, índices
(tenant,type,active) e (tenant,createdAt). CHECKs de inteiros, retry, array não vazio
sem null e horários/minutos/ordem. Não editar migrations históricas.
Novo apps/api/src/notifications e testes API unitários/integração; AppModule, schema,
docs/scheduling.md, domain-model.md e README atualizados conforme decisões relevantes.

## Testes e aceite

Cobrir os 40 cenários solicitados, cenários 08:00/240/janela08–20, limites inclusivos,
dias bloqueados (domingo), mínimo, retry23:00, maxAttempts, inatividade, múltiplas regras,
DST gap/fold e offset fracionado, ausência de efeito em Appointment, equivalência preview,
Unit override, tenant, RBAC, DTOs, FK/CHECKs, PATCH final e rollback de auditoria.
Prisma format/generate/validate; pnpm lint; pnpm typecheck; pnpm test; pnpm db:test;
pnpm build; pnpm format:check; git diff --check. Revisar migration e aplicar primeiro
no PostgreSQL descartável, depois pnpm db:migrate local; migrate status/diff e smoke.

## Riscos e rollback

Motor limitado e determinístico, sem executor de comunicação. Múltiplas regras não
são deduplicadas nesta camada. Decisão de ação por ausência de resposta e estado da
confirmação será composta em tarefas futuras. Resultados são teóricos, não registros
de tentativa nem promessa de entrega. Rollback por migration compensatória preservando
configuração/auditoria; não apagar histórico nem remover tabela com endpoints ativos.

## Resultado

Implementação concluída, limitada à TASK-014.

### Arquivos criados

- apps/api/src/notifications/notification.schedule.ts
- apps/api/src/notifications/notification.dto.ts
- apps/api/src/notifications/notification.repository.ts
- apps/api/src/notifications/notifications.service.ts
- apps/api/src/notifications/notifications.controller.ts
- apps/api/src/notifications/notifications.module.ts
- apps/api/test/notifications.test.ts
- apps/api/integration/notifications.test.ts
- packages/database/prisma/migrations/20261002020000_notification_rules/migration.sql
- docs/exec-plans/TASK-014-notification-rules.md

### Arquivos alterados nesta tarefa

- packages/database/prisma/schema.prisma
- apps/api/src/app.module.ts
- docs/scheduling.md
- docs/domain-model.md
- README.md

Sem alteração de dependências, worker ou migrations históricas. Preservadas as
alterações anteriores de outras tarefas.

### Banco e contratos finais

NotificationRule novo, relação reversa Tenant.notificationRules; enums
NotificationType, OutsideWindowPolicy, NoResponseAction; eventos de criação e
atualização em AuthEventType. Weekday foi reutilizado. allowedWeekdays é enum[]
com NOT NULL explícito (Prisma gera array nullable no SQL), CHECK cardinalidade 1–7,
array unidimensional sem null. CHECKs também protegem janela crescente abaixo de
24:00 com segundos zero, números não negativos/positivos e retry habilitado com
intervalo positivo. Índices tenant/type/active, tenant/createdAt, unique tenant/id
para integridade; sem unique tenant/type.

Os seis endpoints previstos foram implementados. Responses omitem tenantId,
timestamps internos e dados do paciente; cálculo retorna somente decisão/instante/
motivo. Preview e resolve não persistem tentativa nem alteram Appointment.

### Testes e comandos executados

12 grupos unitários novos cobrem resolução, bordas, dias, mínimo, retries, limites,
inatividade, DTOs, DST gap/fold, timezone IANA fracionado e entradas inválidas.
8 grupos de integração novos cobrem os contratos HTTP/PostgreSQL, isolamento,
RBAC/CSRF, múltiplas regras, persistência dos dois tipos e ações, PATCH final,
preview igual ao motor, Unit override, cálculo por Appointment, ausência de
cancelamento, constraints físicas, auditoria transacional e revogação/contexto.
Os 40 cenários solicitados estão distribuídos nesses grupos.

Comandos: prisma format; pnpm --filter @atendente/database build;
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script;
pnpm lint; pnpm typecheck; pnpm test; pnpm db:test; pnpm build; pnpm db:validate;
pnpm format:check; git diff --check; pnpm db:migrate; prisma migrate status;
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code.
Migration revisada antes de aplicar. Testes de banco executam migrations do zero,
reaplicação e seed idempotente em PostgreSQL descartável.

Durante validação foi corrigida a tipagem explícita do array de usuários da fixture.

### Resultados

- Lint: 8 tarefas aprovadas. Typecheck: 10 tarefas aprovadas.
- Unitários: 48 aprovados (API 41, database 3, worker 3, web 1).
- Integração: 128 aprovados (API 126 e database 2), sem falhas.
- Build: 7 tarefas aprovadas. Prisma validate e formatação aprovados.
- Cenário obrigatório: consulta 2026-10-06 08:00 America/Sao_Paulo, offset240,
  janela08–20, PREVIOUS -> 2026-10-05 20:00 local = 2026-10-05T23:00:00.000Z.
  NEXT -> SKIP/AT_OR_AFTER_APPOINTMENT; SKIP -> OUTSIDE_ALLOWED_WINDOW.

### Limites e pendências

Sem erros funcionais pendentes encontrados. Cálculo é teórico e não executa intenções;
retry/ação persistidos não representam registro de tentativas/resposta. Executor futuro
precisa revalidar horário atual, estado/resposta e deduplicação entre regras. Limite de
busca 9 dias e precisão de minuto são explícitos. Janela noturna cruzando meia-noite
não aceita. Sem novas funcionalidades de TASK-015, envio real ou imagens Docker refeitas.

Migration 20261002020000_notification_rules aplicada no banco local. 13 migrations
atualizadas, sem diferença schema/banco. Smoke compilado: /health 200 e
/notification-rules sem sessão 401; API encerrou normalmente. git diff --check aprovado.
