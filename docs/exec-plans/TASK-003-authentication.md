# TASK-003 — Autenticação

## Objetivo e escopo

Implementar identidade de usuário, hash de senha, login/logout, sessão segura, proteção básica e base para MFA. Aceite: rotas privadas recusam acesso sem sessão válida. Não implementar UserTenant, tenant ativo, RBAC, pacientes, CRUD de clínicas, cadastro público, recuperação de senha ou UI de autenticação.

## Decisões e limites

- Usuário é identidade global conforme docs/tenancy.md. Email normalizado e único; estados mínimos ACTIVE/DISABLED. Nenhuma identidade concede acesso a dados de clínica nesta tarefa.
- Hash scrypt nativo Node (N=131072, r=8, p=1, salt aleatório de 16 bytes). Senhas de 12–128 caracteres; sem truncamento. Comparação em tempo constante e hash fictício para usuário inexistente.
- Sessão opaca de 32 bytes aleatórios, apenas SHA-256 armazenado no PostgreSQL. Expiração absoluta de 8 horas, rotação a cada login, revogação no logout; usuário desativado ou com MFA pendente não autentica.
- Cookie HttpOnly, SameSite=Strict, Path=/, Secure em produção e prefixo __Host-. Origin exato obrigatório nos POSTs, JSON limitado, CORS somente para AUTH_ORIGIN com credenciais. Produção exige origem HTTPS. AUTH_SECRET com pelo menos 32 caracteres para pseudonimizar chaves de throttle/auditoria; sem fallback inseguro.
- Guard global protege rotas por padrão; apenas health e login explicitamente públicos. GET /auth/me mostra somente id, nome e email do próprio usuário. POST /auth/logout revoga no servidor.
- Rate limit persistente por IP (20) e email (5) em janela de 15 minutos; incremento atômico no PostgreSQL. Resposta de login genérica para credenciais inválidas, usuário desativado e MFA pendente. Não confiar em X-Forwarded-For sem proxy configurado.
- Eventos de autenticação auditáveis em tabela própria append-only na aplicação, sem senha, token ou email nos eventos. Identidade global não tem tenant nesta fase; não criar bypass de autorização de clínica.
- Base de MFA: mfa_enabled e mfa_required. Ambas bloqueiam login por senha e sessões existentes até implementar verificação do segundo fator. Não implementar TOTP incompleto nem criar SUPER_ADMIN; a obrigatoriedade desse perfil permanece na política e deverá ser ligada ao provisionamento quando houver papéis.
- Provisionamento inicial somente por comando local de desenvolvimento, com credenciais via variáveis de ambiente, sem senha padrão ou usuário automático no seed.
- Configuração fail-closed no startup; testes unitários usam módulo de teste sem banco, integração HTTP completa usa PostgreSQL descartável pelo runner existente.

Referências: [OWASP senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) e [OWASP sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Arquivos afetados

apps/api/src/auth, bootstrap/app module/health, testes da API, packages/database/schema e migration, scripts/test-database.mjs, manifests/lockfile, Compose, .env.example, README, docs/security.md e docs/domain-model.md.

## Banco

Adicionar users, auth_sessions, auth_events e auth_throttles. UUIDs e timestamptz; índice unique de email normalizado, hash de sessão único, índices de expiração e FK de sessão/usuário. Sem alteração de tenants/units existentes. Revisar SQL antes de aplicar.

## Riscos e mitigação

Sem sessão de tenant ou papéis, autenticação apenas identifica o usuário e não autoriza operações clínicas. MFA completo fica explicitamente indisponível e falha fechado. Scrypt consome memória: limitar a concorrência de hash. Throttle persiste entre reinícios. Tokens nunca em logs/JSON. Sessões expiradas permanecem inválidas independentemente da limpeza; rotina operacional de limpeza poderá ser adicionada posteriormente.

## Validação

- Schema validate/generate e revisão SQL da migration incremental.
- Hash/salt/verificação, validação de entrada/configuração e guard padrão em testes sem banco.
- Integração PostgreSQL + HTTP: login, cookies, sessão persistente, logout/replay, expiração, rotação, usuário desativado/MFA, CSRF, enumeração, throttle concorrente, auditoria e indisponibilidade de endpoints de cadastro.
- pnpm lint, pnpm typecheck, pnpm test, pnpm db:test, pnpm build, pnpm format:check, git diff --check.
- Migrations no banco local sem reset; smoke checks Docker quando aplicável.

## Rollback

Preservar dados existentes. Reverter aplicação e preparar migration compensatória somente após backup/revisão; não apagar tabelas ou volume automaticamente. Para invalidar sessões, operação administrativa explícita na tabela auth_sessions.

## Resultado

Implementação concluída; validações locais, integração e Docker aprovados.

- Migration incremental revisada antes da aplicação: cria somente enums/tabelas/índices/FKs de identidade. CHECK garante email normalizado; nenhum DROP ou mudança em tenants/units.
- Migrations aplicadas do zero e reaplicadas no PostgreSQL descartável; seed anterior permanece idempotente. Container de teste removido.
- Sete cenários HTTP de autenticação passaram: guard/entrada/CSRF; login/cookie/persistência após reinício; rotação/logout/replay/auditoria; expiração/status/MFA; erro genérico/throttle após reinício; limite atômico por conta/IP; cookie de produção.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (dez testes sem banco), `pnpm db:test` e `pnpm build`: passaram.
- `pnpm install --frozen-lockfile`: passou. Migration aplicada no PostgreSQL local sem reset, preservando clínica/unidade existentes.
- AUTH_SECRET aleatório e AUTH_ORIGIN adicionados somente ao .env local ignorado pelo Git; nenhum usuário/senha padrão criado no banco local.
- Provisionamento local está disponível via `pnpm auth:create-user`; instruções no README. Não foi criado endpoint público de cadastro.
- Limite de MFA documentado explicitamente: somente base fail-closed, sem segundo fator utilizável ou perfil SUPER_ADMIN.

## Arquivos criados

- apps/api/src/auth/auth.config.ts
- apps/api/src/auth/auth.input.ts
- apps/api/src/auth/auth.service.ts
- apps/api/src/auth/auth.guard.ts
- apps/api/src/auth/auth.controller.ts
- apps/api/src/auth/auth.module.ts
- apps/api/src/auth/database.service.ts
- apps/api/src/auth/password.ts
- apps/api/src/auth/create-user.ts
- apps/api/test/auth.test.ts
- apps/api/integration/auth.test.ts
- packages/database/prisma/migrations/20261001010000_authentication/migration.sql
- Este plano.

## Verificação final do ambiente

- `docker compose up --build -d api`: passou, incluindo build do monorepo na imagem.
- API atualizada e PostgreSQL saudável; `/health` retorna 200 e `/auth/me` sem sessão retorna 401.
- Schema validado e migration diff sem divergência; `pnpm format:check`, instalação congelada e `git diff --check` passaram.
- TASK-004 não iniciada.
