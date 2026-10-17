# TASK-010 — Profissionais

## Objetivo e escopo

Cadastrar Provider e vínculos N:N ProviderService e ProviderUnit, com alterações,
ativação/inativação, overrides opcionais e consulta de profissionais habilitados
por serviço. Sem horários, disponibilidade, agenda, integrações ou TASK-011.
Preservar alterações anteriores da TASK-009.

## Decisões técnicas

- Módulo providers com controllers/services/repositories por responsabilidade.
  Provider não representa User nem Specialty; associação operacional é com Service.
- Provider: UUID, tenant, name obrigatório até 200, professionalType textual
  obrigatório até 80 (extensível, sem enum fechado), registrationNumber textual
  opcional/nulável até 120. Sem validação de conselho ou unicidade de nome/registro
  enquanto não houver regra específica; homônimos e registros entre tenants são válidos.
- ProviderService: IDs, tenant, provider/service, active default true e timestamps.
  durationOverrideMinutes inteiro positivo opcional/null; priceOverride Decimal(12,2)
  opcional/null. Não copiar defaults de Service: null significa herdar futuramente.
  Zero monetário é override válido, não ausência. API usa strings decimais como
  TASK-009; extrair parser monetário compartilhado para evitar divergência.
- ProviderUnit: associação mínima com UUID, tenant, provider/unit, active default true
  e timestamps para rastreabilidade. Um Provider atende várias unidades sem duplicação.
- Nenhuma exclusão física. PATCH active=false/true em entidades/vínculos; unicidade
  tenant/provider/service e tenant/provider/unit inclusive quando inativos.
  IDs dos relacionados são imutáveis após criar vínculo; outro vínculo exige POST.
- RBAC: provider.manage no cadastro de profissionais; provider.manage + service.manage
  nos vínculos e consulta por Service; provider.manage + unit.view nos vínculos de
  unidade. Políticas existentes, sem novas concessões/roles. Validar guard, service,
  repository e filtros SQL. FKs compostas impedem relacionamento cross-tenant.
- GET /services/:serviceId/providers lista Provider ativo com ProviderService ativo
  e Service ativo no tenant. Serviço inativo retorna []; externo/inexistente 404.
  Essa é somente habilitação cadastral, não disponibilidade, licença validada ou
  confirmação de unidade/horário. Specialty é agrupamento via Service, nunca vínculo
  direto. Não exigir unidade nesta consulta, pois a unidade será contexto futuro.
- Listas administrativas de vínculos incluem inativos e aceitam filtro active.
  Listas de Provider também aceitam active. Vínculos podem ser configurados com
  entidades inativas; inativar profissional não apaga nem modifica vínculos em cascata.
- Responses com selects explícitos: campos de negócio e resumos do Service/Unit,
  sem tenantId/timestamps internos. Lista de aptos omite registro profissional.
  Overrides permanecem null mesmo quando defaults do Service mudarem.
- Transações Serializable e auditoria atômica com atores/IDs/campos/active. Sem copiar
  nome, registro ou preços para logs. Conflitos duplicidade/concorrência 409 genérico;
  IDs externos/inexistentes retornam mesmo 404. Não adicionar lógica no frontend.

## Arquivos e banco

Criar apps/api/src/providers, testes unitários e integração, migration aditiva.
Alterar schema Prisma, app.module, parser monetário em configuration/dto e seu uso
em catalog.dto. Atualizar README, domínio/tenancy apenas pelas decisões necessárias.
Models novos Provider/ProviderService/ProviderUnit; relações reversas Tenant/Unit/Service;
Service ganha unique (tenantId,id) para FK composta. AuthEventType ganha eventos
created/updated de profissional e seus dois vínculos. Sem enum de domínio novo.
Índices tenant/active, tenant/provider/active e tenant/service/active ou unit/active;
FKs Restrict, uniques de pares e CHECK de override positivo/preço válido.

## Testes e critérios de aceite

Cobrir os 24 cenários solicitados: criação, consulta, atualização, N:N nos dois
sentidos, múltiplas unidades, defaults sem cópia, precisão/zero/null, inativação
com histórico, rejeição de overrides inválidos, duplicidade, RBAC e isolamento
incluindo IDs conhecidos em todas as rotas. Constraints PostgreSQL, concorrência,
revogação entre validação e query e rollback de auditoria. Regressão TASK-003–009.

## Validação

Prisma format/generate/validate; pnpm lint; pnpm typecheck; pnpm test;
pnpm db:test; pnpm build; pnpm format:check; git diff --check.
Revisar migration antes de aplicar; primeiro PostgreSQL descartável, depois
pnpm db:migrate e prisma migrate status/diff. Smoke da API compilada local.

## Riscos e rollback

Habilitação cadastral não calcula disponibilidade; nenhuma regra futura será
inventada. Registro textual não significa licença verificada. Desabilitar rotas
novas se necessário e preservar histórico; reversão de schema exige backup e
migration compensatória revisada. Não editar migrations históricas.

## Resultado

Concluída. TASK-011 não iniciada.

### Arquivos criados

- apps/api/src/providers/provider.dto.ts
- apps/api/src/providers/provider-access.ts
- apps/api/src/providers/provider.repository.ts
- apps/api/src/providers/provider-service.repository.ts
- apps/api/src/providers/provider-unit.repository.ts
- apps/api/src/providers/eligible-providers.repository.ts
- apps/api/src/providers/providers.service.ts
- apps/api/src/providers/provider-services.service.ts
- apps/api/src/providers/provider-units.service.ts
- apps/api/src/providers/providers.controller.ts
- apps/api/src/providers/provider-services.controller.ts
- apps/api/src/providers/provider-units.controller.ts
- apps/api/src/providers/eligible-providers.controller.ts
- apps/api/src/providers/providers.module.ts
- apps/api/test/providers.test.ts
- apps/api/integration/providers.test.ts
- packages/database/prisma/migrations/20261001080000_providers/migration.sql
- docs/exec-plans/TASK-010-providers.md (criado antes do código)

### Arquivos alterados nesta tarefa

packages/database/prisma/schema.prisma, apps/api/src/app.module.ts,
apps/api/src/configuration/dto.ts, apps/api/src/catalog/catalog.dto.ts,
README.md, docs/domain-model.md e docs/tenancy.md. Alterações anteriores da TASK-009
preservadas; nenhuma migration histórica alterada. Parser monetário extraído sem
alterar contrato de Service, coberto pela regressão de catálogo.

Models novos Provider/ProviderService/ProviderUnit. Tenant, Unit e Service ganharam
relações reversas; Service ganhou unique composto para FK. Nenhum enum novo:
AuthEventType recebeu seis valores para criação/alteração das três entidades.

### Endpoints

- GET/POST /providers; GET/PATCH /providers/:id.
- GET/POST /providers/:providerId/services; PATCH /providers/:providerId/services/:id.
- GET/POST /providers/:providerId/units; PATCH /providers/:providerId/units/:id.
- GET /services/:serviceId/providers.

PATCH active=false/true implementa inativação/ativação. IDs dos PATCHs de vínculos
identificam ProviderService/ProviderUnit. Consultas administrativas aceitam active;
consulta de habilitados sempre usa Provider/Service/ProviderService ativos.

### Cobertura dos cenários obrigatórios

Os 24 cenários solicitados estão cobertos nos 11 subtestes de integração:

- Criação, N:N, nomes/registros entre tenants e projeções: 1, 2, 6, 7, 9, 19, 20, 23.
- Múltiplas unidades sem duplicar profissional: 17, 21.
- Overrides ausentes permanecem null e acompanham defaults sem cópia: 13, 14.
- Entradas inválidas e precisão/zero/limites/null: 10, 11, 12, 24.
- IDs conhecidos e vínculos cruzados: 3, 4, 5, 18–21.
- Duplicidade, concorrência, inativação com histórico e reativação: 8, 15, 16.
- RBAC em todas as rotas e permissões cumulativas: 22.

Adicionais: CSRF, queries/DTOs por whitelist, FK/CHECK no PostgreSQL, revogação
entre validação e query/transação, contexto ausente e rollback de auditoria.
Três testes unitários cobrem Provider, overrides monetários/duração e unidades/filtros.

### Comandos executados e resultados

- pnpm --filter @atendente/database exec prisma format: schema formatado.
- pnpm --filter @atendente/database build: Prisma client gerado e compilado.
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script:
  migration gerada, revisada e acrescida de CHECKs antes da aplicação.
- pnpm lint: aprovado.
- pnpm typecheck: aprovado após ajustar tipos de tupla das permissões nos decorators.
- pnpm test: 25 testes aprovados (API 20, database 3, web 1, worker 1).
- pnpm db:test: 2 testes de banco + 76 testes de integração da API aprovados,
  sem falhas/skips. Migrations do zero/reaplicação e seed repetido aprovados em
  PostgreSQL 17 descartável, incluindo regressões TASK-003–009.
- pnpm db:validate: schema válido.
- pnpm build: 7 tarefas aprovadas.
- pnpm db:migrate: 20261001080000_providers aplicada ao banco local atendente_ia.
- pnpm --filter @atendente/database exec prisma migrate status: 9 migrations, sem pendências.
- pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --exit-code: sem divergências gerenciadas pelo
  Prisma. CHECKs exercitados diretamente pelos testes PostgreSQL.
- pnpm format:check e git diff --check: aprovados.
- Smoke nativo node --env-file=.env, API compilada em porta efêmera: /health=200;
  /providers, vínculos de serviços/unidades e /services/:id/providers=401 sem sessão.
  Processo de smoke encerrado.

### Limites e pendências

Sem falhas de validação pendentes. Consulta de habilitados é cadastral, não agenda,
licença validada ou disponibilidade por unidade. Registro/tipo profissional seguem
textuais sem regras de conselho inventadas. Nomes/registros não são chaves de identidade.
Overrides null não persistem defaults; zero monetário é valor explícito. Não há
horários, frontend novo, integrações ou TASK-011. Imagens Docker de aplicação não
foram reconstruídas; build e smoke usam código local compilado.
