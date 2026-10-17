# TASK-012 — HOLD

## Objetivo e escopo

AppointmentHold persistido em PostgreSQL com criação transacional, duração/buffers,
expiração, liberação e proteção concorrente. Sem Appointment, confirmação definitiva,
conversas, automações gerais ou TASK-013. Preservar alterações anteriores.

## Contrato, dados e autorização

- Model AppointmentHold: UUID, tenant, patient, contact opcional, service, provider,
  unit, startAt/endAt/expiresAt, status ACTIVE/EXPIRED/RELEASED/CONSUMED e timestamps.
  Conversation ainda não existe: não criar UUID solto sem FK nem modelo futuro;
  conversationId será acrescentado com relação composta na tarefa de conversas.
- startAt/endAt representam atendimento. Backend calcula endAt pela duração override
  de ProviderService ou duração de Service. endAt opcional no request é apenas
  asserção: rejeitar se diferente do calculado ou <=startAt. Intervalos [início,fim).
- occupiedStartAt/occupiedEndAt armazenam a ocupação incluindo buffers do Service
  no momento da criação. São snapshot necessário para que editar Service não
  altere retroativamente conflitos de HOLDs existentes; não copiar também buffers
  ou duração. Datas absolutas TIMESTAMPTZ em UTC. Preço não pertence ao HOLD.
- POST exige requestId UUID de idempotência; unique tenant/requestId, vinculado ao
  usuário criador. Retry idêntico devolve o mesmo HOLD sem estender TTL. Payload
  diferente, usuário diferente ou asserção endAt incompatível =409. HOLD encerrado
  continua encerrado no retry; nova tentativa exige requestId novo. Sem infraestrutura
  genérica de idempotência. RequestId/creatorId/ocupação técnica não saem na response.
- CREATE: appointment.create + patient.view + unit.view; READ: appointment.view +
  patient.view; RELEASE: appointment.cancel + patient.view. Permissões existentes.
  Contact fornecido exige contact.view e vínculo ContactPatient ativo VERIFIED com
  FULL ou SCHEDULING_ONLY; NO_ACCESS/DECLARED/REVOKED recusados sem expor dados.
  Sem Contact, é operação administrativa do painel autorizado, como Patient atual.
- Todas as entidades e vínculos exigem tenant da sessão. Service/Provider/Unit,
  ProviderService/ProviderUnit ativos. Patient próprio obrigatório. Contact ativo
  quando fornecido. FKs compostas garantem integridade; nenhuma autorização pelo UI.

## Disponibilidade e timezone

- Reutilizar loader/algoritmo estrutural TASK-011 na mesma transação, com escopo e
  permissões da operação de HOLD (AGENT não precisa de provider.manage).
- startAt é RFC3339 com offset explícito ou Z e precisão de minuto; não aceitar
  horário local solto. Calcular duração e buffers como minutos decorridos UTC.
- Converter cada minuto real da ocupação para relógio local via Intl e timezone
  efetivo Unit/Tenant; todos devem caber nas janelas estruturais. Validar também
  extremos e mesma data civil. Limite técnico de 26 horas para uma data com DST,
  evitando loops sem limite. Ocupação cruzando dia local recusada nesta entrega.
- Offsets explícitos distinguem horários repetidos em DST; nenhum instante cai em
  hora local inexistente. Não inventar conversão de data/hora local em UTC: entrada
  já é instante. Gaps/folds são avaliados minuto a minuto, sem timezone do browser.
  startAt deve ser futuro; TTL vence no máximo no início do atendimento.

## Concorrência e expiração

- PostgreSQL fonte de verdade. Transação Serializable; lock por UPDATE do ProviderUnit
  usado também na TASK-011. Revalidar sessão/permissões/relacionamentos no SQL.
- Expirar ACTIVE vencidos do tenant/provider/unit dentro da transação antes de
  verificar conflito/inserir. Conflito consulta ACTIVE e expiresAt > relógio do banco.
  Assim, worker atrasado não bloqueia novo horário. Instante de referência obtido
  por clock_timestamp() após lock, não relógio do cliente.
- EXCLUDE GiST em tenant/provider/unit e tstzrange(occupiedStartAt,occupiedEndAt,'[)')
  WHERE status=ACTIVE protege também INSERT concorrente. O predicado não usa now();
  vencidos são retirados de ACTIVE sob lock antes da inserção. P2034/conflito =>409.
  Retry idempotente após conflito de serialização pode recuperar registro existente.
- Função pura de sobreposição reutilizável para futuramente incluir Appointment;
  não criar engine genérico. Escopo de conflito nesta tarefa: provider+unit conforme
  solicitação. Política de bloqueio global do profissional entre unidades é futura.
- HOLD_TTL_SECONDS configurável, default 300, validado; expiresAt=min(now+TTL,startAt).
  Expiração é terminal; RELEASE idempotente, vencido passa EXPIRED, CONSUMED não é
  liberado/reutilizado. Sem endpoint de consumo. Leitura reavalia expiresAt mesmo
  antes da limpeza; lista ativa por provider/unit/período nunca inclui vencidos.
- Worker existente recebe polling mínimo HOLD_SWEEP_INTERVAL_MS (default 30000),
  com exclusão de execuções sobrepostas e encerramento limpo. Sweep por tenant,
  transação e auditoria sistêmica; tolera múltiplos workers, sem Redis obrigatório.
  Não criar endpoints administrativos globais de expiração/listagem.

## Arquivos, banco e endpoints

Novo módulo holds, helpers de conflito/timezone, DTOs/config/repositories/services/
controllers/testes. Compartilhar expiração em packages/database para API/worker;
refatorar apenas loader estrutural necessário. Alterar schema, app.module, worker,
compose/env, lockfile e documentação relacionada. Migration aditiva e índices por
recurso/status/tempo/expiração e tenant/patient/service. EXCLUDE, CHECKs, uniques/FKs.

POST /appointment-holds; GET /appointment-holds/:id;
POST /appointment-holds/:id/release; GET /appointment-holds/active exige providerId,
unitId, startAt/endAt (período máximo 31 dias), retorna somente resumos de ocupação
(id/startAt/endAt/expiresAt), sem dados de outros pacientes.

## Testes e aceite

Cobrir os 30 cenários pedidos, concorrência real por duas instâncias da API,
retries idempotentes, estados terminais, expiração sem worker e pelo sweep,
buffers antes/depois inclusive snapshots após edição, overrides, blocks/extras,
UTC/offset/DST, constraints físicas, isolamento, RBAC, revogação e auditoria atômica.
Regressão TASK-003–011. Worker unitário com dependência injetável e sweep real no DB.

## Validação e rollback

Prisma format/generate/validate; pnpm lint/typecheck/test/db:test/build;
pnpm format:check; git diff --check. Revisar migration, aplicar primeiro no PostgreSQL
descartável, depois db:migrate local, migrate status/diff e smoke compilado API/worker.
Rollback exige preservar HOLDs/auditoria e migration compensatória revisada; nunca
remover proteção de conflitos com rotas ainda expostas nem editar migrations antigas.

## Resultado

Implementação concluída, limitada à TASK-012.

### Arquivos criados

- apps/api/src/holds/hold-access.ts
- apps/api/src/holds/hold.config.ts
- apps/api/src/holds/hold.dto.ts
- apps/api/src/holds/hold.repository.ts
- apps/api/src/holds/holds.controller.ts
- apps/api/src/holds/holds.module.ts
- apps/api/src/holds/holds.service.ts
- apps/api/src/holds/scheduling-conflict.ts
- apps/api/test/holds.test.ts
- apps/api/integration/holds.test.ts
- apps/worker/src/hold-expiry.ts
- apps/worker/test/hold-expiry.test.ts
- packages/database/src/hold-expiration.ts
- packages/database/prisma/migrations/20261002000000_appointment_holds/migration.sql
- docs/exec-plans/TASK-012-appointment-hold.md

### Arquivos alterados nesta tarefa

- apps/api/src/app.module.ts
- apps/api/src/availability/availability.repository.ts
- apps/worker/src/main.ts
- apps/worker/src/bootstrap.ts
- apps/worker/package.json
- packages/database/prisma/schema.prisma
- packages/database/src/index.ts
- pnpm-lock.yaml
- .env.example
- compose.yaml
- README.md
- docs/domain-model.md
- docs/scheduling.md

Alterações anteriores de outras tarefas foram preservadas, sem incluir novas
funcionalidades da TASK-013.

### Banco e validação

Model AppointmentHold e relações reversas; enum AppointmentHoldStatus e eventos
HOLD_CREATED/HOLD_RELEASED/HOLD_EXPIRED em AuthEventType. Índices compostos:
tenant/provider/unit/status/occupiedStartAt/occupiedEndAt, status/expiresAt/tenant,
tenant/patient, tenant/service. Unique tenant/requestId. FKs compostas tenant,
CHECKs de intervalos finitos/ordem/expiração, EXCLUDE GiST de ocupação ACTIVE e
trigger impedindo transição de estados terminais. Não alterar migrations antigas.

Comandos executados: pnpm install --lockfile-only --offline; pnpm install
--frozen-lockfile --offline; Prisma format/generate/migrate diff;
pnpm db:validate; pnpm lint; pnpm typecheck; pnpm test; pnpm db:test; pnpm build;
pnpm db:migrate; prisma migrate status; prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --exit-code;
pnpm format:check; git diff --check.

Testes: 34 unitários (API 27, database 3, worker 3, web 1) e 104 de integração
(API 102 e database 2), todos aprovados. A suíte de HOLD cobre os 30 cenários
solicitados em 12 grupos, incluindo duas instâncias HTTP, concorrência SQL direta,
idempotência, rollback de auditoria, sweep concorrente e constraints físicas.
Migrations testadas do zero e reaplicadas com seed idempotente em banco descartável.
Migration aplicada localmente; 11 migrations atualizadas, sem diferença Prisma/DB.

### Limites e pendências

Conversation ainda ausente; vínculo futuro exige migration com FK. Conflitos
restritos a provider/unit, conforme escopo; não definir política global entre
unidades. Ocupação deve permanecer numa data local. Sem Appointment, confirmação,
integrações ou cálculo final de slots. CONSUMED não possui operação pública nesta
entrega. Imagens Docker não foram reconstruídas; testes usam PostgreSQL em Docker
e aplicações locais compiladas.

Validação final: lint, typecheck, testes, build (7 tarefas), format:check e
git diff --check aprovados. Smoke compilado: GET /health 200; HOLD sem sessão 401;
worker executou ciclos com PostgreSQL e encerrou por SIGTERM com código 0,
aguardando varredura antes de desconectar.
