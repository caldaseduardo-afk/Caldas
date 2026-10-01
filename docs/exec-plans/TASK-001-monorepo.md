# TASK-001 — Inicializar monorepo

## Objetivo e escopo

Criar exclusivamente a base executável do monorepo conforme TASK-001. Aplicações web (Next.js), API (NestJS) e worker (contexto NestJS sem filas), cinco pacotes compartilhados, pnpm, Turborepo, ESLint, Prettier, TypeScript, testes básicos e Docker local.

## Decisões técnicas

- Node.js 22 e pnpm 10; dependências fixadas pelo lockfile.
- Web com App Router; API oferece somente GET /health, sem dados ou operações de negócio; worker inicializa o contexto e aguarda encerramento.
- Monólito modular com processos separados conforme arquitetura. Sem microserviços ou integrações externas.
- Pacotes database/domain/types são reservas explícitas, sem entidades, Prisma, migrations ou autorização antecipada. Não há acesso a banco nem dados de pacientes. Operações futuras exigirão tenant validado no backend conforme docs/security.md e TASK-004.
- ESLint e TypeScript compartilhados em packages/config; testes com runner nativo Node; tsc para NestJS (preserva metadados de decorators) e tsx para React. Testes verificam boot HTTP, renderização web e ciclo de vida do worker.
- Docker Compose sobe os três processos em modo desenvolvimento. PostgreSQL/Redis e Prisma ficam para suas tarefas; Docker local não implica antecipar TASK-002.

## Arquivos afetados

Configurações na raiz (package.json, workspace, lockfile, turbo, ESLint, Prettier, ignores, Dockerfile e compose.yaml); apps/{web,api,worker}; packages/{database,domain,types,ui,config}; README.md; este plano.

## Banco

Nenhuma mudança, migration ou seed.

## Riscos e limites

Compatibilidade de versões será verificada por instalação, build e testes. Docker depende de daemon disponível. Health check não verifica dependências ainda inexistentes. Isolamento e autorização completos dependem das tarefas posteriores; nenhum endpoint de negócio é exposto nesta entrega.

## Validação e aceite

- pnpm install
- pnpm lint
- pnpm format:check
- pnpm typecheck
- pnpm test
- pnpm build
- docker compose config --quiet
- docker compose up --build -d e smoke checks, se o daemon estiver disponível.
  Aceite: instalação e checks passam; oito workspaces reconhecidos; processos inicializam; nenhum avanço funcional para TASK-002.

## Rollback

Remover os arquivos de scaffolding desta tarefa e reverter a seção adicionada ao README. Sem dados persistidos ou migrations a desfazer.

## Resultado

Implementação concluída exclusivamente para TASK-001.

- `corepack enable` habilitou pnpm no ambiente.
- `pnpm install` concluído; uma tentativa inicial falhou por indisponibilidade temporária de rede. Nova execução com `--network-concurrency=2 --fetch-retries=1 --fetch-timeout=20000` passou.
- `pnpm install --frozen-lockfile`: passou.
- `pnpm lint`: oito pacotes passaram.
- `pnpm typecheck`: oito pacotes passaram (mais build da UI).
- `pnpm test`: três testes passaram (API HTTP, página web e worker).
- `pnpm build`: sete builds passaram, incluindo Next.js.
- `pnpm format:check`: passou após normalização de Markdown e exclusão do arquivo gerado next-env.d.ts.
- `docker compose config --quiet`: passou.
- `docker info`: Docker Desktop iniciado após autorização do usuário; daemon 29.5.3 disponível.
- `docker compose up --build -d`: build e inicialização dos três containers passaram.
- Smoke checks: web HTTP 200; API `/health` retorna `{"status":"ok"}`; worker permanece em execução, sem erros de compilação. Containers deixados ativos para desenvolvimento.
- `git diff --check`: passou.

O formatter adicionou apenas linhas em branco em BACKLOG.md, docs/architecture.md e docs/product-spec.md, sem mudanças de conteúdo. README.md recebeu instruções de execução. .gitignore preserva as exclusões existentes e adiciona tsbuildinfo. O arquivo next-env.d.ts é gerado pelo Next.js e não participa da verificação de formatação.

## Inventário de arquivos criados

- `.dockerignore`
- `.prettierignore`
- `.prettierrc.json`
- `Dockerfile`
- `apps/api/package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/bootstrap.ts`
- `apps/api/src/health.controller.ts`
- `apps/api/src/main.ts`
- `apps/api/test/bootstrap.test.ts`
- `apps/api/tsconfig.build.json`
- `apps/api/tsconfig.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/next-env.d.ts`
- `apps/web/package.json`
- `apps/web/test/page.test.tsx`
- `apps/web/tsconfig.json`
- `apps/worker/package.json`
- `apps/worker/src/app.module.ts`
- `apps/worker/src/bootstrap.ts`
- `apps/worker/src/main.ts`
- `apps/worker/test/bootstrap.test.ts`
- `apps/worker/tsconfig.build.json`
- `apps/worker/tsconfig.json`
- `compose.yaml`
- `docs/exec-plans/TASK-001-monorepo.md`
- `eslint.config.mjs`
- `package.json`
- `packages/config/eslint.config.mjs`
- `packages/config/package.json`
- `packages/config/src/index.ts`
- `packages/config/tsconfig.base.json`
- `packages/config/tsconfig.json`
- `packages/database/package.json`
- `packages/database/src/index.ts`
- `packages/database/tsconfig.json`
- `packages/domain/package.json`
- `packages/domain/src/index.ts`
- `packages/domain/tsconfig.json`
- `packages/types/package.json`
- `packages/types/src/index.ts`
- `packages/types/tsconfig.json`
- `packages/ui/package.json`
- `packages/ui/src/index.tsx`
- `packages/ui/tsconfig.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `turbo.json`

## Revisão da TASK-001

Escopo mantido: apenas infraestrutura, sem TASK-002.

Problemas identificados e correções implementadas:

- Cache do Turbo não inclui configurações compartilhadas fora dos diretórios dos consumidores. ESLint da raiz e arquivos JSON/MJS de packages/config incluídos como dependências globais, sem incorporar logs gerados.
- Testes NestJS via tsx não emitem os metadados de decorators usados pelo build TypeScript. Compilar os testes com tsc e adicionar regressão de injeção por construtor.
- Scripts dev usam processos de shell em paralelo sem supervisão. Usar tsc-watch para reiniciar o servidor apenas após compilação válida e encerrar os processos filhos.
- Garantir geração dos tipos Next.js no typecheck e build das dependências antes de dev, inclusive sem artefatos anteriores.

Validação: lint, typecheck, testes e build; teste de injeção; verificação de hashes do Turbo; inicialização e encerramento dos serviços Docker atualizados. Resultados registrados abaixo.

### Resultados da revisão

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check` e `git diff --check`: passaram.
- Quatro testes passaram. A nova regressão de injeção por construtor falhou com o executor antigo (tsx), confirmando o problema, e passou com tsc + Node.
- Alteração temporária de tsconfig.base.json invalidou os hashes de todos os consumidores; restaurar o arquivo reproduziu os hashes anteriores.
- Dev compila dependências automaticamente; typecheck da web gera os tipos Next antes do tsc.
- Docker inclui procps para permitir ao tsc-watch encerrar a árvore de processos; Compose usa init para encaminhamento de sinais e coleta de processos filhos.
- Novos arquivos nesta revisão: apps/api/tsconfig.test.json, apps/worker/tsconfig.test.json e apps/api/test/dependency-injection.test.ts. Lockfile, scripts, ignores, Dockerfile, Compose e README atualizados.
- Sem entidades, migrations, integrações ou mudanças de produto e autorização.
- Docker reconstruído com sucesso; web HTTP 200, API health OK e processo do worker ativo.
- Em container descartável, removidos os artefatos `.next` e `packages/ui/dist`: `pnpm typecheck --force` passou, regenerando os tipos e compilando a UI automaticamente.
- `docker compose stop -t 10 api worker`: ambos encerraram por SIGTERM (143), sem SIGKILL/timeout. Serviços reiniciados após a verificação.
