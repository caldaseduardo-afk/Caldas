# TASK-004 — Multi-tenancy

## Objetivo e escopo

Adicionar vínculo UserTenant, seleção explícita de tenant na sessão e isolamento em contexto, services e repositories. Reutilizar Tenant/Unit criados na TASK-002, sem duplicar entidades. Manter autenticação da TASK-003. Não implementar RBAC, gestão de papéis/permissões ou CRUD de clínicas/unidades.

## Decisões técnicas

- UserTenant com PK composta (user_id, tenant_id), role obrigatório apenas como metadado, active e timestamps. Sem inferir permissões a partir de role e sem bypass SUPER_ADMIN.
- AuthSession recebe active_tenant_id opcional e FK composta para o vínculo do próprio usuário. Login sempre começa sem tenant selecionado; seleção afeta somente a sessão atual.
- Somente Tenant.status = ACTIVE permite acesso. Qualquer outro valor falha fechado; não introduzir enum/transições de ciclo de vida nesta tarefa.
- Endpoints autenticados: GET /tenancy/tenants lista apenas vínculos ativos com tenants ativos; POST /tenancy/active seleciona {tenantId}; GET /tenancy/active retorna o tenant atual. Seleção passa pela proteção Origin existente e é auditada com usuário/tenant na mesma transação.
- Contexto NestJS por requisição, preenchido a partir da sessão validada no AuthGuard. Guard de tenant global exige seleção por padrão. Exceções explícitas: rotas públicas e rotas de identidade/listagem/seleção, necessárias para iniciar ou recuperar o contexto.
- Nunca aceitar X-Tenant-ID/query/body como contexto. TenantId no POST de seleção é apenas uma solicitação validada contra UserTenant no servidor.
- Services validam contexto; repositories validam novamente e aplicam filtros com tenant, vínculo ativo, sessão válida e usuário habilitado na própria consulta. Snapshot por requisição: se outra requisição trocar o tenant da mesma sessão, a requisição antiga falha fechado em vez de operar no novo tenant.
- GET /tenancy/units e GET /tenancy/units/:id expõem somente id, tenantId e name para exercitar isolamento sobre recurso já existente. ID externo/inexistente retorna 404. Sem endpoints de escrita de Unit: CRUD continua na TASK-006.
- Sem RLS nesta tarefa, conforme segurança prevê avaliação posterior. Nenhum client Prisma entregue ao frontend/IA.
- Comando local de desenvolvimento cria UserTenant para usuário/tenant existentes, com role AGENT informativo e auditoria; sem cadastro público ou atribuição via HTTP.

## Arquivos afetados

Schema/migration Prisma; auth service/guard/module; módulo compartilhado de banco; módulo tenancy (contexto, guard, controller, services/repositories e provisionamento local); testes unitários/integração; manifests; documentação de segurança/domínio/tenancy/README.

## Banco e revisão

Criar user_tenants; adicionar active_tenant_id em auth_sessions e FK composta; adicionar eventos TENANT_SELECTED/TENANT_MEMBERSHIP_GRANTED e tenant_id opcional em auth_events. Sessões existentes permanecem válidas para identidade, porém sem tenant. Remover vínculo remove sessões associadas via FK; marcar vínculo inativo bloqueia consultas imediatamente. Auditar seleção e concessão sem registrar token. Revisar SQL antes de aplicar, sem reset ou DROP de dados existentes.

## Riscos e limites

Revogações e troca concorrente não podem depender de cache de autorização. Revalidar filtros no SQL evita intervalo entre validação e leitura. Rotas futuras devem manter guard de tenant padrão e usar repositories com contexto obrigatório. Esta entrega não autoriza operações funcionais por papel, não seleciona tenant automaticamente e não cria UI.

## Testes e aceite

- Tenant A não lista/lê recurso de B mesmo conhecendo ID; inverso também.
- Usuário com múltiplos vínculos só acessa o tenant selecionado; duas sessões e requisições concorrentes não misturam contexto.
- Sessão sem tenant, vínculo inexistente/inativo, tenant inativo e tentativa de forjar contexto são bloqueados.
- Revogação/remoção após login e após captura do contexto bloqueia services/repositories; seleção persiste após reinício.
- Chamadas diretas de services/repositories sem contexto falham; FK recusa tenant não vinculado.
- CSRF na seleção; auditoria; regressão completa da autenticação; endpoints de escrita ausentes.
- pnpm lint, pnpm typecheck, pnpm test, pnpm db:test, pnpm build, pnpm format:check, prisma validate/migrate diff e git diff --check.
- Migration local após teste em banco descartável; atualizar API Docker e verificar respostas sem sessão.

## Rollback

Preservar migrations aplicadas e dados. Reversão de schema requer backup e migration compensatória revisada. Não apagar volume ou recriar tenants. Aplicação anterior ignora colunas adicionais; revogar sessões explicitamente se necessário.

## Resultado

Implementação concluída no escopo da TASK-004. Tenant/Unit existentes foram reutilizados; UserTenant, seleção persistida por sessão e filtros obrigatórios foram adicionados. Nenhum RBAC funcional ou CRUD da TASK-006 foi implementado.

Arquivos criados:

- apps/api/src/database/database.module.ts;
- apps/api/src/tenancy/tenant.context.ts, tenant.guard.ts, tenant.repository.ts e unit.repository.ts;
- apps/api/src/tenancy/tenancy.module.ts, tenancy.controller.ts e tenancy.service.ts;
- apps/api/src/tenancy/grant-membership.ts;
- apps/api/test/tenancy.test.ts e apps/api/integration/tenancy.test.ts;
- packages/database/prisma/migrations/20261001020000_multi_tenancy/migration.sql;
- este plano.

Ajustes durante validação: guard global declarado explicitamente com Scope.REQUEST para resolver corretamente o contexto no NestJS; dependência de build adicionada às tarefas de typecheck/test do database no Turbo para impedir duas gerações concorrentes do Prisma Client. Testes HTTP verificam a proteção padrão do guard. Tipagem das respostas JSON e formatação corrigidas.

Validações aprovadas:

- pnpm lint;
- pnpm typecheck;
- pnpm test (incluindo 7 testes da API);
- pnpm db:test (PostgreSQL descartável, migrations do zero e reaplicação, seed idempotente, teste de banco e 15 cenários de autenticação/tenancy em duas suítes);
- pnpm build;
- pnpm format:check;
- pnpm install --frozen-lockfile;
- pnpm db:migrate e pnpm db:validate;
- pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code (sem divergência);
- git diff --check.

Migration revisada e aplicada ao banco local sem reset: o único DROP remove o índice simples de sessão, substituído por índice composto. Dados existentes foram preservados. Docker atualizado com `docker compose up --build -d api`; build integral no container aprovado. Smoke HTTP via Node/fetch confirmou /health 200, /auth/me 401 e /tenancy/active 401 sem sessão. TASK-005 não iniciada.
