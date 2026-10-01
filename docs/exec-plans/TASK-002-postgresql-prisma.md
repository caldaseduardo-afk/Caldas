# TASK-002 — PostgreSQL + Prisma

## Objetivo e escopo

Configurar PostgreSQL local, Prisma no pacote database, migration inicial e seed mínimo idempotente. Não iniciar TASK-003: sem usuários, senhas, autenticação, endpoints de negócio ou integrações.

## Decisões técnicas e ambiguidades

- PostgreSQL 17 em Docker, porta vinculada a localhost, volume persistente e healthcheck. Credenciais somente no ambiente/.env ignorado pelo Git; sem senha padrão no Compose.
- Prisma 7.10.0 e adapter-pg da mesma versão. Client gerado como CommonJS para manter a base NestJS existente. Configuração Prisma carrega .env da raiz; gerar/compilar não depende de conexão ao banco.
- Migration limitada a Tenant e Unit para concretizar UUID, timestamps e tenant_id obrigatório com FK. São estruturas de persistência, sem implementar os fluxos das TASK-004/006.
- UUID nativo PostgreSQL com gen_random_uuid(); timestamps timestamptz(3), created_at com default e updated_at atualizado pelo Prisma. Escritas SQL administrativas devem atualizar updated_at explicitamente.
- Nomes SQL em snake_case. Unit possui índice/unique composto (tenant_id, id), preparando futuras FKs compostas que preservem o tenant. Excluir tenant com unidades será RESTRICT.
- A documentação não define estados de Tenant nem estrutura de address. Preservar status como texto obrigatório sem default, sem enum/transições ou decisões de autorização. Seed usa o rótulo demonstrativo ACTIVE. Address permanece texto obrigatório; modelagem adicional será decidida na tarefa funcional.
- Timezone obrigatório no Tenant; seed usa America/Sao_Paulo. Instantes armazenados em timestamptz; servidor local em UTC.
- Pacote database é infraestrutura exclusiva do backend; nenhum consumidor web/IA nem repository público nesta tarefa. FK e índice não substituem autorização/isolamento, que continuam na TASK-004.
- Seed explícito e restrito a NODE_ENV=development, transacional e idempotente; IDs fixos fictícios. Não sobrepor dados já existentes.
- Testes unitários entram em pnpm test; integração real roda via pnpm db:test, em container isolado com senha aleatória, removido ao final. Sem reset do banco de desenvolvimento.

Referências técnicas: [gerador Prisma](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) e [configuração Prisma](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).

## Arquivos afetados

packages/database (schema, migrations, configuração, client factory, seed e testes), scripts de teste de banco, manifests/lockfile, Turbo, Compose, Dockerfile, ignores, .env.example, README e docs/domain-model.md. Nenhum módulo funcional da API será criado.

## Mudanças de banco e revisão

Criar tenants e units com PK UUID, timestamps, tenant_id NOT NULL, FK restritiva e unique composto. Revisar SQL antes de aplicar: sem DROP, sem dados reais e sem extensões desnecessárias.

## Riscos

Porta 5432 pode estar ocupada (configurável). Credenciais alteradas no .env não alteram senha de um volume já inicializado. O schema inicial não implementa isolamento por sessão/RLS. Seeds e migrations são comandos explícitos, nunca executados no build ou na inicialização da API.

## Testes e critérios de aceite

- pnpm install --frozen-lockfile
- pnpm db:generate e pnpm db:validate
- docker compose up -d postgres: banco saudável
- pnpm db:migrate e pnpm db:seed (duas vezes)
- pnpm db:test: migrations do zero/reaplicação, seed idempotente, UUIDs, timestamps, obrigatoriedade e FK de tenant_id, consultas por tenant e rejeição de exclusão com dependências
- pnpm lint, pnpm typecheck, pnpm test, pnpm build, pnpm format:check
- docker compose config --quiet e build Docker

## Rollback

Não haverá reset automático. Antes de reverter migration em ambiente com dados, realizar backup e preparar migration compensatória revisada. O container de testes é descartável; volume de desenvolvimento é preservado por docker compose down (sem -v).

## Resultado

Implementação concluída; validações locais, integração e build Docker aprovados.

- SQL gerado por `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` e revisado antes de aplicar: somente CREATE SCHEMA/TABLE/INDEX e FK, sem remoção de dados.
- Prisma schema validado e client compilado. Arquivos gerados não são versionados.
- PostgreSQL saudável, volume persistente inicializado. `.env` local criado com senha aleatória e permissão 0600, sem registrar seu conteúdo.
- Migration aplicada no banco de desenvolvimento; seed executado duas vezes.
- `pnpm db:test` passou: banco descartável migrado do zero; segunda aplicação sem pendências; seed duas vezes; UUID, timestamps, tenant obrigatório, FK restritiva, consultas compostas e preservação de dados editados validados. Container de teste removido ao final.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (sete testes sem banco), `pnpm build`, `pnpm format:check` e `git diff --check`: passaram.
- Nenhum fluxo da TASK-003 foi implementado. Isolamento/autorização de negócio permanecem explicitamente fora desta tarefa.

## Arquivos criados

- packages/database/prisma/schema.prisma
- packages/database/prisma/migrations/migration_lock.toml
- packages/database/prisma/migrations/20261001000000_initial/migration.sql
- packages/database/prisma.config.ts
- packages/database/src/development-seed.ts
- packages/database/src/seed.ts
- packages/database/tsconfig.test.json
- packages/database/test/unit.test.ts
- packages/database/test/integration.test.ts
- scripts/test-database.mjs
- Este plano; `.env` apenas local, ignorado pelo Git.

### Verificações finais

- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: sem diferenças entre banco e schema.
- Consulta de conferência: uma clínica e uma unidade após duas execuções do seed.
- `pnpm install --frozen-lockfile`: passou; `.env` e client gerado confirmados como ignorados pelo Git.
- Teste adicional garante que URL inválida não propague o input com credenciais; lint, typecheck e sete testes sem banco passaram novamente.

- `docker compose build api`: passou com o Dockerfile compartilhado, incluindo geração Prisma e build do monorepo sem `.env` na imagem.
