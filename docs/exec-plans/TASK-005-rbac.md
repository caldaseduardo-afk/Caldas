# TASK-005 — RBAC

## Objetivo e escopo

Definir catálogo de roles/permissões e associações persistidas, seed idempotente,
guard global de autorização e validação em services/repositories. Preservar sessão,
seleção explícita de tenant e isolamento da TASK-004. Não implementar CRUD de
clínicas/unidades, gestão de usuários/papéis, funcionalidades clínicas ou TASK-006.

## Decisões e ambiguidades

- Catálogo global de roles e permissions com relação RolePermission; UserTenant
  mantém um role por vínculo, agora com FK. Role de um tenant não vale em outro.
- Roles CLINIC_ADMIN, AGENT e DOCTOR operacionais; SUPER_ADMIN reservado e sem
  concessões enquanto MFA completo não existir; MANAGER reservado para o futuro.
  Sem wildcard ou bypass. Papéis legados desconhecidos são preservados como
  desabilitados, sem permissões, antes de criar a FK.
- A documentação não define a matriz exata. Pergunta enviada ao usuário antes de
  conceder permissões clínicas: proposta CLINIC_ADMIN com catálogo da clínica,
  AGENT com conversas/pacientes/agenda, DOCTOR com leitura de pacientes/agenda.
  Após a proposta explícita, o usuário instruiu continuar. Implementar essa matriz
  e registrá-la em docs/tenancy.md; não acrescentar permissões funcionais além dela.
- Acrescentar tenant.view e unit.view para proteger as leituras mínimas já existentes.
  Os três perfis operacionais mantêm essas leituras de metadados da TASK-004.
- Guard global nega rotas sem política explícita; decorators de permissões exigem
  todas as permissões. Exceções explícitas de identidade/seleção/logout não dão
  acesso a recursos. TenantOptional sozinho não isenta autorização.
- Contexto, usuário, sessão, vínculo e permissões são consultados no banco, sem
  confiar em role/permission enviados pelo cliente e sem cache de autorização.
  Services e repositories verificam permissão; consultas ao recurso repetem o
  filtro de role/permissão para resistir a revogação após a validação.
- 401 sem autenticação; 403 sem contexto/permissão; 404 para recurso inexistente
  ou de outro tenant quando o usuário tem a permissão de leitura.
- Seed de catálogo separado do seed de dados fictícios, executável sem criar
  tenants/usuários. Associações definidas são reconciliadas transacionalmente;
  executar seed é aplicação deliberada da política versionada, não inicialização
  automática da API. Sem endpoint de concessão e sem autorização no frontend.
- Escopo por unidade e relação contato/paciente não estão materializados: permissões
  de catálogo não substituem essas futuras regras. Não expor dados clínicos agora.

## Arquivos afetados

Schema/migration e seed no packages/database; módulo permissions e contexto
compartilhado no apps/api; guards de auth, services/repositories/controllers de
tenancy; testes de autorização e isolamento; scripts e documentação relevante.

## Banco

Criar roles, permissions e role_permissions, FK de UserTenant.role. Migration
preserva dados e cria roles legados sem privilégios. Revisar SQL antes de aplicar.
Seed não promove usuários nem altera seus vínculos. Sem reset de banco.

## Riscos

Escalada entre tenants, role indevido enviado pelo cliente, falta de metadata em
novas rotas, permissões antigas em sessão e revogação entre checagem e consulta.
Cobrir cada caso em testes. SUPER_ADMIN permanece sem acesso privilegiado até MFA.

## Testes, comandos e aceite

- Catálogo/associações completos e seed idempotente; papéis reservados sem privilégios.
- Permissões críticas administrativas permitidas/negadas conforme matriz aprovada.
- 403 autenticado sem permissão, 401 sem sessão, proteção padrão sem decorator.
- CLINIC_ADMIN de A não acessa B por ID; usuário com papéis diferentes por tenant
  não herda privilégios de outro vínculo; headers/query não alteram autorização.
- Revogação de permissão/role/vínculo refletida sem novo login, inclusive nas queries.
- Validação direta de services/repositories e regressão de autenticação/tenancy.
- pnpm lint; pnpm typecheck; pnpm test; pnpm db:test; pnpm build;
  pnpm format:check; pnpm db:validate; git diff --check.
- Após testes descartáveis, aplicar migration e seed RBAC local, verificar schema
  sem drift e API Docker. Não avançar para TASK-006.

## Rollback

Preservar dados/migrations aplicadas. Reversão de schema somente com backup e
migration compensatória revisada. Não retornar a uma versão que ignore RBAC
mantendo endpoints disponíveis. Revogar sessões/indisponibilizar API se necessário.

## Resultado

Implementação concluída no escopo de RBAC. Catálogo com 19 permissões e cinco
roles definidos; três operacionais. Permissões por role: CLINIC_ADMIN 19, AGENT 13,
DOCTOR 4; SUPER_ADMIN/MANAGER nenhuma. Nenhum endpoint da TASK-006 criado.

### Arquivos criados

- packages/database/src/rbac-catalog.ts, rbac-seed.ts e seed-rbac.ts;
- packages/database/prisma/migrations/20261001030000_rbac/migration.sql;
- apps/api/src/permissions/authorization.service.ts, permission.decorator.ts,
  permission.guard.ts e permissions.module.ts;
- apps/api/src/tenancy/tenant-context.module.ts;
- apps/api/test/permissions.test.ts e apps/api/integration/permissions.test.ts;
- este plano.

Schema, seed existente, exports/manifests, módulos de autenticação/tenancy,
controllers/services/repositories, testes anteriores e documentação foram
atualizados. O contexto compartilhado evita dependência circular de módulos.
O antigo teste de tenant usa CLINIC_ADMIN; SUPER_ADMIN agora possui testes
explícitos de recusa, mesmo com concessões indevidas inseridas no banco de teste.

### Validação

- pnpm lint: aprovado;
- pnpm typecheck: aprovado após corrigir tipagem dos doubles no teste do guard;
- pnpm test: aprovado, incluindo nove testes da API;
- pnpm db:test: aprovado, com quatro migrations do zero/reaplicação, seed
  idempotente, dois testes de banco e vinte cenários em três suítes de integração
  da API (autenticação, RBAC, tenancy); matriz completa exercitada por permissão;
- pnpm build: aprovado;
- pnpm format:check e git diff --check: aprovados.

Migration SQL revisada: somente tabelas de catálogo, preservação de roles existentes
e FKs; sem DROP/reset. Migration local aplicada; pnpm db:seed:rbac e pnpm db:validate aprovados.
`pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource
--to-schema prisma/schema.prisma --exit-code` não detectou divergência.
`pnpm install --frozen-lockfile` também passou.

Smoke da API compilada localmente contra o banco local: /health 200, /auth/me 401
e /tenancy/units 401 sem sessão. Instância temporária encerrada após verificação.

Limitação de ambiente: `docker compose up --build -d api` falhou em duas tentativas
por ConnectTimeoutError ao baixar pnpm do registry.npmjs.org via Corepack. Não é
erro de compilação da aplicação; pnpm build local passou. A imagem/container
anterior não foi substituída. Para executar a versão nova no Docker, repetir esse
comando quando o acesso ao registry estiver disponível. Nenhum volume foi apagado.
TASK-006 não iniciada.
