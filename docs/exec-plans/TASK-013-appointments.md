# TASK-013 — Consultas

## Objetivo e escopo

Appointment definitivo, conversão atômica de HOLD, criação direta prevista no
backlog, consulta/listagem, estados, cancelamento e remarcação com histórico.
Sem notificações, integrações, Conversation, slots finais ou TASK-014.
Preservar alterações anteriores do workspace.

## Decisões e contrato

- Appointment com campos solicitados e ocupação com buffers em snapshot, seguindo
  TASK-012. holdId opcional único liga conversão ao HOLD do mesmo tenant.
- PENDING_CONFIRMATION, CONFIRMED e CHECKED_IN bloqueiam; COMPLETED, NO_SHOW,
  CANCELLED e RESCHEDULED são históricos e não bloqueiam. Criação inicia PENDING_CONFIRMATION.
- Transições centralizadas: PENDING_CONFIRMATION -> CONFIRMED/CANCELLED/RESCHEDULED;
  CONFIRMED -> CHECKED_IN/CANCELLED/RESCHEDULED/NO_SHOW; CHECKED_IN -> COMPLETED.
  Terminais não retornam. NO_SHOW exige início passado; COMPLETED exige fim passado;
  CHECKED_IN exige início alcançado (não inventar tolerância clínica). Cancelar/remarcar
  permitidos nos dois estados iniciais, sem regras clínicas adicionais ainda inexistentes.
- Criação direta aceita source WEB/PHONE/MANUAL (default MANUAL), notes opcional;
  sources futuros persistem no enum mas não autorizam simular integração/IA/importação.
  createdByType=USER e createdById da sessão, nunca do payload. Campos de calendário
  somente estruturais: calendarProvider/externalEventId nulos, syncStatus NOT_REQUIRED.
- Conversão recebe holdId/source/notes, revalida relações/duração/buffers/disponibilidade.
  Mudanças em duração/buffers que invalidam snapshot exigem novo HOLD (409), sem
  deslocar silenciosamente o horário escolhido. HOLD consumido recebe 409; unique holdId
  impede duplicação. Criação direta repetida conflita pelo intervalo; sem infraestrutura
  nova de idempotência. Cancelamento repetido é idempotente, sem auditoria duplicada.
- Remarcação direta recebe novo provider/unit/service/startAt (patient/contact originais
  imutáveis), cria sucessor e marca anterior RESCHEDULED na mesma transação. Unique
  previousAppointmentId impede bifurcação; FK composta tenant e paciente impede cadeia
  cross-tenant/paciente. Pode reutilizar intervalo original liberado dentro da transação.
- Motivo de cancelamento fica em cancellationReason, cancelledAt e ator da sessão
  permanece em AuthEvent atômico. Não duplicar cancelledBy no model. Notes/motivos
  não são copiados para auditoria. Leitura de notas somente detalhe administrativo.
- Permissões existentes: create+patient.view+unit.view para criação/conversão;
  appointment.view+patient.view para leitura; appointment.cancel+patient.view para
  cancelar; appointment.reschedule+patient.view+unit.view para remarcar;
  appointment.create+patient.view para transições operacionais. Sem ampliar DOCTOR.
  Contact fornecido/herdado exige contact.view e política VERIFIED de TASK-012.

## Concorrência, banco e timezone

Extrair validação de ocupação/relacionamentos e consulta de conflitos de HOLD em
helper compartilhado. Serializable + lock ProviderUnit + retry limitado. Ambas as
entidades consultam Appointment bloqueante e HOLD ACTIVE não vencido. Expirar vencidos
sob lock. EXCLUDE em Appointment e trigger de serialização/checagem cruzada nas duas
tabelas protegem também gravação direta SQL; sem Redis como fonte de verdade.
Conversão consome HOLD e cria consulta na mesma transação, com auditoria: falha desfaz
tudo. Remarcação libera original somente dentro da transação que cria sucessor.
Locks concorrentes podem exigir retry/409; não prometer sucesso sem limite.
UTC/TIMESTAMPTZ, RFC3339 com offset/minuto, duração decorrida e validação minuto a minuto
na data local da Unit/Tenant como TASK-012; manter limite de uma data local/26h.

Migration nova, sem editar históricas: Appointment, enums, eventos, relações reversas,
FKs compostas, índices tenant/provider/unit/status/ocupação, tenant/patient/start,
tenant/contact, tenant/service, tenant/sync, tenant/created, external event único por
tenant/provider quando não nulo, hold e predecessor únicos. CHECKs de intervalo,
autoria e cancelamento. Documentar correção de product-spec: HOLD é entidade separada.

## Arquivos afetados e endpoints

Novo módulo apps/api/src/appointments com DTO/service/repository/controller/estados,
helper compartilhado em scheduling, testes unitários e integração; holds repository
passa a reutilizar helper. Schema/index e migration em packages/database. AppModule,
docs de agenda/domínio/produto e README conforme contrato final.

POST /appointments (direto); POST /appointments/from-hold;
GET /appointments (intervalo obrigatório até 31 dias e filtros provider/unit/patient/status);
GET /appointments/:id; POST /appointments/:id/cancel;
POST /appointments/:id/reschedule; POST /appointments/:id/status.
Sem PATCH genérico de horários/status nem DELETE.

## Testes, validação e aceite

Cobrir 50 cenários solicitados, rollback de conversão/remarcação/auditoria, RBAC,
revogação, projeções mínimas, FK cross-tenant, buffers, override, BLOCK/EXTRA,
estados terminais, concorrência API/API e HOLD/Appointment, SQL direto e regressão.
Prisma format/generate/validate; pnpm lint; pnpm typecheck; pnpm test; pnpm db:test;
pnpm build; pnpm format:check; git diff --check. Revisar migration antes de aplicar
em DB descartável, depois pnpm db:migrate local e verificar status/diff. Smoke API.

## Riscos e rollback

Conflitos por provider+unit como TASK-012; política global entre unidades indefinida.
Sem política de antecedência/cancelamento por clínica; somente operações humanas
explicitamente autorizadas. Não criar bypass de disponibilidade. Campos externos
não ativam integração. Rollback por migration compensatória após preservar histórico,
sem remover proteção com endpoints ativos. Não apagar consultas para rollback.

## Resultado

Implementação e validação concluídas, limitadas à TASK-013.

### Inventário criado

- apps/api/src/appointments/appointment-access.ts
- apps/api/src/appointments/appointment.dto.ts
- apps/api/src/appointments/appointment.repository.ts
- apps/api/src/appointments/appointment.state.ts
- apps/api/src/appointments/appointments.controller.ts
- apps/api/src/appointments/appointments.module.ts
- apps/api/src/appointments/appointments.service.ts
- apps/api/src/scheduling/schedule.ts
- apps/api/test/appointments.test.ts
- apps/api/integration/appointments.test.ts
- packages/database/prisma/migrations/20261002010000_appointments/migration.sql
- docs/exec-plans/TASK-013-appointments.md

### Inventário alterado nesta tarefa

- apps/api/src/app.module.ts
- apps/api/src/holds/hold.repository.ts
- apps/api/integration/contacts.test.ts (corrigir falso positivo: fragmento 619 pode
  ocorrer em UUID de auditoria; verificar números completos, nome e ID externo)
- packages/database/prisma/schema.prisma
- README.md
- docs/product-spec.md
- docs/domain-model.md
- docs/scheduling.md

Nenhuma alteração de tarefa anterior foi revertida. Nenhuma migration histórica
foi editada. Não houve mudança de dependências nesta tarefa.

### Model, enums e integridade

Appointment novo; AppointmentHold recebe relação reversa e unique tenant/id para
FK. Tenant/Unit/Patient/Contact/Service/Provider/ProviderService/ProviderUnit/
UserTenant recebem relações reversas. Enums AppointmentStatus, AppointmentSource,
AppointmentActorType e CalendarSyncStatus; sete novos eventos em AuthEventType.

Além dos índices previstos, CHECK valida intervalos finitos e ordem, autoria USER
com usuário (e ausência de usuário para outros tipos), coerência de cancelamento,
predecessor diferente da própria consulta e consistência dos campos de calendário.
EXCLUDE de Appointment filtra os três estados bloqueantes. Trigger compartilhado
atualiza ProviderUnit e verifica ocupação da outra tabela sob lock; erros SQL não
expõem dados e a API retorna conflito genérico. Estados/transições são validados
centralmente em appointment.state.ts, sem PATCH genérico nem exclusão física.

### Testes

Unitários exercitam matriz completa de transições, limites temporais e DTOs.
Integração PostgreSQL/HTTP em duas instâncias cobre conversão, expirados/liberados/
consumidos, tenant, FK, source/autoria/sync, BLOCK/EXTRA, duração/buffers, snapshots,
revalidação de contato/habilitação/bloqueio, estados, cancelamento idempotente,
remarcação com cadeia e rollback, RBAC/CSRF/revogação, projeção de respostas,
auditoria atômica, concorrência consulta/consulta, consulta/HOLD e conversão dupla,
EXCLUDE e trigger cruzado em escrita SQL direta. Testa CHECKED_IN bloqueante e
NO_SHOW histórico sem ocupar. Os 50 cenários solicitados estão distribuídos nos
14 grupos de integração e na matriz unitária; regressões anteriores incluídas.

### Comandos de validação

- pnpm --filter @atendente/database exec prisma format
- pnpm --filter @atendente/database build
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test (banco descartável, migrations do zero/reaplicação, seed/reexecução)
- pnpm build
- pnpm db:validate
- pnpm db:migrate
- prisma migrate status
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
- pnpm format:check
- git diff --check

Correções durante validação: narrowing do enum source, corpo vazio permitido em
cancelamento sem motivo, timestamp único na fixture histórica para evitar deriva
entre campos e falso positivo no teste antigo de auditoria de contatos.

### Limites preservados

A API expõe operações humanas; enums futuros não ativam integração, IA ou importação.
Datas precisam permanecer numa data local; conflito por profissional/unidade.
Sem políticas clínicas de tolerância/antecedência ainda não modeladas; regras temporais
operacionais mínimas documentadas. Remarcação usa novo horário direto, sem HOLD
específico. Notes do sucessor são explícitas no request (default null), sem copiar
silenciosamente notas antigas. Histórico original e auditoria permanecem acessíveis.
Nenhuma funcionalidade da TASK-014 foi implementada; imagens Docker não reconstruídas.

### Resultado final

- Lint: 8 tarefas aprovadas. Typecheck: 10 tarefas aprovadas.
- Unitários: 36 aprovados (API 29, database 3, worker 3, web 1).
- Integração: 119 aprovados (API 117, database 2), incluindo concorrência.
- Build: 7 tarefas aprovadas. Prisma validate, format:check e diff --check aprovados.
- Migration 20261002010000_appointments revisada, testada do zero e reaplicada no
  PostgreSQL descartável; aplicada no PostgreSQL local. 12 migrations atualizadas.
  Prisma migrate diff não encontrou diferença entre schema e banco local.
- Smoke compilado: /health 200, /appointments e /appointment-holds/active sem
  autenticação 401; API encerrou normalmente.
- Sem erros pendentes encontrados. Limitações funcionais acima permanecem explícitas.
