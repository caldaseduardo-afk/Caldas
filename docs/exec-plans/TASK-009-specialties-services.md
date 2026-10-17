# TASK-009 — Especialidades e serviços

## Objetivo e escopo

Implementar catálogo administrativo de Specialty (área) e Service (atendimento
concreto que futuramente será agendável), com criação/listagem/detalhe/alteração e
ativação/inativação. Somente TASK-009, sem profissionais, agenda ou integrações.
Preservar alterações existentes da TASK-008.

## Decisões técnicas

- Módulo catalog agrupa controllers/services/repositories separados para as duas
  entidades, no monólito NestJS existente. Sem camada genérica de CRUD.
- RBAC existente service.manage protege todas as operações administrativas,
  inclusive leitura, sem inventar nova concessão a AGENT/DOCTOR. Futuras consultas
  de agendamento poderão definir política própria na tarefa correspondente.
- IDs UUID, tenant obrigatório, campos camelCase na API e snake_case no banco.
  name obrigatório até 200 caracteres; description opcional/nulável até 2000.
  active boolean default true, PATCH permite false/true, sem exclusão física.
- Service tem specialtyId obrigatório; duração inteira positiva, buffers inteiros
  não negativos default zero. Limite técnico Int PostgreSQL: 2147483647; sem
  inventar limite de duração clínica. Specialty inativa continua válida como
  agrupamento administrativo; inativação não altera o active dos serviços nem
  presume regras futuras de disponibilidade. Todas as listagens incluem inativos
  salvo filtro explícito; isso não constitui disponibilidade para agendamento.
- Preço opcional/nulável, Decimal(12,2), de 0.00 a 9999999999.99. API recebe string
  decimal com ponto e até duas casas; retorna string com duas casas. Rejeitar
  JSON number, expoente, negativo e arredondamento implícito. Sem moeda/conversão.
- Unique Specialty(tenantId,name), Service(tenantId,specialtyId,name), comparação
  exata/case-sensitive do PostgreSQL após trim. Sem identidade inferida por case,
  acentos ou busca complexa. Mesmo nome pode existir em tenants distintos e serviços
  com mesmo nome em especialidades distintas. Inativação não libera o nome.
- Filtros active=true/false; Service também specialtyId UUID. Sem filtro nome,
  pois não há listagem por nome preexistente. Queries extras/inválidas rejeitadas.
  Filtro specialtyId externo/inexistente retorna 404 genérico, sem revelar existência.
- Guards/services/repositories revalidam service.manage/tenant e filtros SQL
  repetem autorização. FK composta garante mesmo tenant para Service/Specialty.
  Respostas whitelist omitem tenantId e timestamps técnicos. Auditoria atômica
  registra ator/recurso/campos alterados, sem descrições/preços copiados em logs.
- Escritas Serializable, conflitos de unicidade/concorrência retornam 409 genérico;
  falha de auditoria desfaz operação. IDs externos/inexistentes recebem mesmo 404.

## Arquivos e banco

Criar apps/api/src/catalog (DTOs, acesso, repositories, services, controllers,
módulo), testes unitários e integração. Alterar app.module, schema Prisma e
AuthEventType (eventos de criação/alteração de Specialty/Service). Documentar
contratos no README e domínio. Nenhuma migration histórica será modificada.

Migration aditiva Specialty/Service, FKs Restrict, unique composto para FK e nomes,
índices tenant/active e tenant/specialty/active. CHECKs de duração, buffers e preço.

## Riscos, testes e aceite

Cobrir os 20 cenários pedidos: CRUD, ativação/inativação sem remoção, precisão
decimal, entradas inválidas, relação correta, nomes por tenant, RBAC e isolamento
inclusive IDs conhecidos, queries filtradas e respostas mínimas. Testar constraints
no PostgreSQL, revogação de autorização e rollback de auditoria. Regressão anterior.

## Comandos de validação

pnpm db:generate; pnpm db:validate; pnpm lint; pnpm typecheck; pnpm test;
pnpm db:test; pnpm build; pnpm format:check; git diff --check.
Revisar migration antes de aplicar, validar primeiro em banco descartável;
depois pnpm db:migrate e prisma migrate status/diff. Smoke da API compilada.

## Rollback

Desabilitar rotas novas se necessário. Preservar registros e auditoria; rollback
SQL exige backup e migration compensatória revisada, nunca editar migration aplicada.

## Resultado

Concluída. TASK-010 não iniciada.

### Arquivos criados

- apps/api/src/catalog/catalog.dto.ts
- apps/api/src/catalog/catalog-access.ts
- apps/api/src/catalog/catalog.module.ts
- apps/api/src/catalog/specialty.repository.ts
- apps/api/src/catalog/service.repository.ts
- apps/api/src/catalog/specialties.service.ts
- apps/api/src/catalog/services.service.ts
- apps/api/src/catalog/specialties.controller.ts
- apps/api/src/catalog/services.controller.ts
- apps/api/test/catalog.test.ts
- apps/api/integration/catalog.test.ts
- packages/database/prisma/migrations/20261001070000_specialties_services/migration.sql
- docs/exec-plans/TASK-009-specialties-services.md (antes da implementação)

### Arquivos alterados

packages/database/prisma/schema.prisma, apps/api/src/app.module.ts, README.md,
docs/domain-model.md e docs/tenancy.md. Nenhuma migration histórica alterada.
Models novos Specialty e Service; Tenant ganhou relações reversas. Nenhum enum
novo; AuthEventType ganhou quatro eventos de criação/alteração.

### Endpoints e testes

GET/POST /specialties; GET/PATCH /specialties/:id; GET/POST /services;
GET/PATCH /services/:id. PATCH active=false/true inativa/ativa. GET /services aceita
specialtyId; ambas as listas aceitam active. Detalhes no README e docs/tenancy.md.

Os 20 cenários obrigatórios estão cobertos nos 10 subtestes de integração:

- Criação e projeções mínimas: cenários 1, 2, 13, 14, 18.
- Validação de duração/buffers/preço: cenários 3–8.
- IDs externos e vínculo composto: cenários 9–12.
- Inativação sem exclusão: cenário 15.
- Atualização, manutenção/troca de especialidade e filtros: cenários 16–17.
- Precisão Decimal/limites/null: cenário 19.
- RBAC, CSRF e revogação: cenário 20.

Adicionais: unicidade local e concorrência, constraints físicas, rollback de
auditoria, ausência de contexto e revogação entre captura de autorização e escrita.
Dois testes unitários cobrem parsing/whitelist de DTOs e filtros.

### Comandos executados e resultados

- pnpm --filter @atendente/database exec prisma format: aprovado.
- pnpm --filter @atendente/database build: client gerado e compilado.
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script:
  migration gerada, revisada e completada com CHECKs antes de aplicação.
- pnpm lint: aprovado.
- pnpm typecheck: aprovado.
- pnpm test: 22 aprovados (API 17, database 3, web 1, worker 1).
- pnpm db:test: 2 testes de banco e 64 testes de integração API aprovados,
  sem falhas/skips; criação do zero, reaplicação e seed repetido aprovados em
  PostgreSQL 17 descartável. Inclui regressões TASK-003–008.
- pnpm db:validate: schema válido.
- pnpm build: 7 tarefas aprovadas.
- pnpm db:migrate: 20261001070000_specialties_services aplicada ao banco local atendente_ia.
- pnpm --filter @atendente/database exec prisma migrate status: 8 migrations, sem pendências.
- pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --exit-code: sem divergências gerenciadas pelo
  Prisma; CHECKs também exercitados nos testes PostgreSQL.
- pnpm format:check e git diff --check: aprovados.
- Smoke nativo com node --env-file=.env, apps/api/dist/bootstrap.js em porta
  efêmera: /health=200; /specialties e /services=401 sem sessão; processo encerrado.

### Riscos e limites

Sem falhas pendentes. Comparação de nomes é exata, não normaliza caixa/acentos.
Inativação de especialidade não cascata para serviços e não define disponibilidade
futura de agenda. Preço não possui moeda/conversão nem aceita números JSON; clientes
devem usar strings decimais. O catálogo é administrativo, restrito a service.manage.
Não há frontend novo, profissionais, agenda ou integrações. Imagens Docker de
aplicação não foram reconstruídas; validação e smoke usam código compilado local.
