# TASK-011 — Disponibilidade estrutural

## Objetivo e escopo

AvailabilityRule semanal relacional, ScheduleException pontual e serviço
getProviderAvailability(providerId,unitId,date) que retorna janelas estruturais.
Sem Appointment/Hold, slots, duração/buffers de Service, integrações ou TASK-012.
Preservar alterações anteriores.

## Decisões técnicas e timezone

- Novo módulo availability no monólito: DTOs, controllers, services, repositories
  e função pura de união/subtração de intervalos locais, sem dependência de banco.
- Datas civis DATE (YYYY-MM-DD) e horários locais TIME(0) sem timezone (HH:mm,
  precisão de minuto, 00:00–23:59). Não são instantes UTC: usam timezoneOverride
  da Unit ou timezone da Tenant. Timestamps técnicos continuam TIMESTAMPTZ UTC.
  Prisma representa DATE/TIME como Date; transporte usa exclusivamente getters UTC
  e âncora 1970-01-01 para TIME, sem converter horário local pelo timezone do host.
- A data fornecida é a data civil na unidade, não um instante recebido do navegador.
  Weekday calculado pelo calendário gregoriano da data civil, independente do host.
  Resposta estrutural inclui date/timezone/windows. Não converter janelas em
  instantes: gaps/horários repetidos de DST exigem política na composição futura
  de slots UTC; aqui janelas continuam conceitos de relógio local explícitos.
- Weekday enum MONDAY..SUNDAY. ValidFrom obrigatório; validUntil opcional/null,
  inclusivo. StartTime < endTime; sem intervalos noturnos atravessando meia-noite.
  Múltiplos períodos são linhas independentes. Impedir interseção de horários
  [start,end) se mesmo tenant/provider/unit/weekday e validades inclusivas sobrepostas.
  Adjacência é permitida. Regras inativas não conflitam nem entram no resultado.
- FKs compostas para Provider/Unit e ProviderUnit (já existente) garantem vínculo
  e tenant. Criar/reativar configuração ativa exige ProviderUnit ativo; configuração
  pode ser inativada após o vínculo ser inativado. Provider/unit inativos não geram
  janelas. Sem exclusão física; providerId/unitId são imutáveis via PATCH.
- Exceções: BLOCK, EXTRA_AVAILABILITY, VACATION, HOLIDAY, MEETING, OTHER.
  Todas exceto EXTRA bloqueiam. Ambos horários null/omitidos = dia inteiro;
  um só horário é inválido. EXTRA exige intervalo explícito. Reason opcional/null,
  texto até 2000. Exceções sobrepostas são válidas, pois a álgebra as normaliza.
- Algoritmo: unir regras válidas + extras ativas, ordenar e fundir sobrepostas ou
  contíguas; subtrair união dos bloqueios ativos, dividindo janelas quando necessário.
  Bloqueios têm precedência sobre extras, inclusive férias/feriado de dia inteiro.
  Essa precedência conservadora é explícita; não há desbloqueio implícito por EXTRA.
- RBAC administrativo existente provider.manage + unit.view para todas as rotas,
  inclusive consulta estrutural; não conceder permissões novas. Guards, services,
  repositories e SQL revalidam tenant/sessão/permissões. Foreign ID = mesmo 404 de
  inexistente; conflito =409; DTO inválido =400; sem permissão =403.
- Criar/alterar usa Serializable e lock do ProviderUnit. Conferir sobreposição no
  backend e no PostgreSQL com EXCLUDE GiST (btree_gist), considerando horário e
  daterange inclusivo, WHERE active. Conflitos concorrentes retornam 409 genérico.
  Auditoria atômica registra ator/recurso/campos/active, sem copiar reason.
- Respostas whitelist sem tenantId/timestamps. Filtros opcionais providerId/unitId/
  active; exceções também dateFrom/dateUntil inclusivos. IDs de filtros externos
  retornam 404, sem permitir inferência; listas sempre limitadas ao tenant.

## Arquivos e banco

Criar apps/api/src/availability (DTOs/acesso/algoritmo/repositories/services/controllers/
módulo), testes unitários e integração, plano e migration aditiva. Alterar schema,
app.module, README, domínio/agenda/tenancy. Nenhuma migration histórica será editada.
Models AvailabilityRule/ScheduleException, enums Weekday/ScheduleExceptionType;
relações reversas Tenant/Provider/Unit/ProviderUnit; eventos created/updated.
Índices tenant/provider/unit/weekday/active e validade; exceções por tenant/provider/
unit/date/active e tenant/date/type/active. CHECKs de horários/datas/pares; EXCLUDE.

## Testes, riscos e aceite

Cobrir os 25 cenários pedidos e conflitos em atualização/reativação/concorrência,
limites inclusivos, adjacência, extras contíguas e precedência de bloqueios,
FK/CHECK/EXCLUDE reais, inativação do vínculo/entidades, RBAC, CSRF, ausência/revogação
de contexto e rollback de auditoria. Timezone herdado/override e independência do
host, incluindo datas de mudança de DST, sem prometer cálculo de instantes.
A migration exige btree_gist disponível (PostgreSQL 17 local suporta extensões).

## Validação e rollback

Prisma format/generate/validate; pnpm lint; pnpm typecheck; pnpm test; pnpm db:test;
pnpm build; pnpm format:check; git diff --check. Revisar SQL, validar no PostgreSQL
descartável antes de pnpm db:migrate local; migrate status/diff e smoke compilado.
Rollback: desabilitar rotas se necessário, preservar dados/auditoria. Alterar banco
somente com backup/migration compensatória, nunca editar histórico aplicado.

## Resultado

Concluída. TASK-012 não iniciada.

### Arquivos criados

- apps/api/src/availability/availability.dto.ts
- apps/api/src/availability/availability.windows.ts
- apps/api/src/availability/availability-access.ts
- apps/api/src/availability/availability-rule.repository.ts
- apps/api/src/availability/schedule-exception.repository.ts
- apps/api/src/availability/availability.repository.ts
- apps/api/src/availability/availability-rules.service.ts
- apps/api/src/availability/schedule-exceptions.service.ts
- apps/api/src/availability/availability.service.ts
- apps/api/src/availability/availability-rules.controller.ts
- apps/api/src/availability/schedule-exceptions.controller.ts
- apps/api/src/availability/availability.controller.ts
- apps/api/src/availability/availability.module.ts
- apps/api/test/availability.test.ts
- apps/api/integration/availability.test.ts
- packages/database/prisma/migrations/20261001090000_availability/migration.sql
- docs/exec-plans/TASK-011-availability.md (criado antes do código)

### Arquivos alterados nesta tarefa

packages/database/prisma/schema.prisma, apps/api/src/app.module.ts, README.md,
docs/domain-model.md, docs/scheduling.md e docs/tenancy.md. Alterações anteriores
preservadas. Nenhuma migration histórica foi alterada.

Models novos AvailabilityRule/ScheduleException; Tenant/Provider/Unit/ProviderUnit
receberam relações reversas. Enums Weekday e ScheduleExceptionType criados;
AuthEventType recebeu quatro eventos de criação/alteração.

### Endpoints e cobertura

GET/POST /availability-rules; GET/PATCH /availability-rules/:id;
GET/POST /schedule-exceptions; GET/PATCH /schedule-exceptions/:id;
GET /providers/:providerId/availability?unitId=UUID&date=YYYY-MM-DD.
PATCH active=false/true inativa/ativa; não há DELETE.

Os 25 cenários obrigatórios estão cobertos nos 12 subtestes de integração:

- Criação, múltiplos períodos e projeções: 1, 8, 21, 23.
- ProviderUnit obrigatório, horários e validade: 4–6.
- Sobreposição, reativação, adjacência e concorrência: 7.
- Bloqueio parcial e exceção inativa: 11, 15, 19.
- Férias/feriados integrais e extras: 12, 13, 16, 17.
- Regras inativas e validades inclusivas: 18, 20.
- Filtros por data/provider/unit: 24.
- IDs externos e criação cross-tenant: 2, 3, 9, 10, 14.
- Timezone herdado/override e datas DST: 25.
- RBAC em todas as rotas: 22.

Adicionais: FK/CHECK/EXCLUDE contra escrita direta, CSRF, revogação de contexto,
Provider/Unit/ProviderUnit inativos, rollback de auditoria. Quatro testes unitários
cobrem DTOs, calendário civil independente de TZ, união/subtração com precedência
e verificação da álgebra minuto a minuto em 24 combinações determinísticas.

### Comandos e resultados

- pnpm --filter @atendente/database exec prisma format: aprovado.
- pnpm --filter @atendente/database build: geração do client e compilação aprovadas.
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script:
  SQL gerado e revisado, acrescido de CHECKs e EXCLUDE antes de aplicar.
- pnpm lint: aprovado.
- pnpm typecheck: aprovado.
- pnpm test: 29 aprovados (API 24, database 3, web 1, worker 1).
- pnpm db:test: 2 testes de banco e 89 de integração API aprovados, sem falhas/skips.
  Migrations do zero/reaplicação, btree_gist/EXCLUDE e seed repetido aprovados em
  PostgreSQL 17 descartável; regressões TASK-003–010 preservadas.
- pnpm db:validate: schema válido.
- pnpm build: 7 tarefas aprovadas.
- pnpm db:migrate: 20261001090000_availability aplicada ao banco local atendente_ia.
- pnpm --filter @atendente/database exec prisma migrate status: 10 migrations, sem pendências.
- pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --exit-code: sem divergências gerenciadas pelo
  Prisma; constraints customizadas verificadas também no PostgreSQL pelos testes.
- pnpm format:check: aprovado após corrigir formatação do teste unitário.
- git diff --check: aprovado.
- Smoke nativo com node --env-file=.env e API compilada em porta efêmera:
  /health=200; regras, exceções e consulta estrutural=401 sem sessão; processo encerrado.

### Riscos e pendências de escopo

Sem falhas de validação pendentes. A resposta é estrutural em relógio local; não
representa instantes/slots confirmáveis. Conversão DST (horários repetidos/ausentes),
ocupação, duração, buffers e HOLDs continuam nas tarefas futuras. EXTRA exige
intervalo explícito; bloqueios prevalecem. Feriados/férias são informados manualmente.
Em outro ambiente, a migration precisa de btree_gist e permissão de instalação.
Não há frontend novo ou integrações. Imagens Docker de aplicação não foram
reconstruídas; build e smoke usam código local compilado.
