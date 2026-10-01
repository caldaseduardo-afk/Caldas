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

Em implementação.
