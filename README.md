# Atendente IA — Plataforma SaaS para Clínicas

Plataforma multi-clínica de atendimento por WhatsApp, agendamento e automação com IA e atendimento humano.

## Objetivo

Permitir que clínicas:

- recebam pacientes pelo WhatsApp;
- atendam com IA e humanos no mesmo histórico;
- cadastrem pacientes, contatos e representantes;
- consultem disponibilidade;
- agendem, remarquem, cancelem e confirmem consultas;
- configurem lembretes e confirmações;
- integrem agendas externas;
- mantenham auditoria completa;
- operem como SaaS multi-tenant.

## Princípio central

> A IA interpreta. O backend autoriza e executa.

A IA nunca deve acessar diretamente banco de dados, credenciais ou integrações sensíveis.

## Estrutura da documentação

- `AGENTS.md` — regras permanentes para o Codex.
- `docs/product-spec.md` — especificação funcional.
- `docs/architecture.md` — arquitetura técnica.
- `docs/domain-model.md` — entidades e relacionamentos.
- `docs/scheduling.md` — agenda, disponibilidade e notificações.
- `docs/conversations.md` — inbox, IA e atendimento humano.
- `docs/security.md` — segurança, autorização e privacidade.
- `docs/integrations.md` — WhatsApp, calendário e IA.
- `docs/tenancy.md` — multi-tenancy e permissões.
- `docs/roadmap.md` — fases de desenvolvimento.
- `BACKLOG.md` — tarefas sequenciais.
- `PROMPT-CODEX.md` — prompt inicial para o Codex.
- `docs/exec-plans/` — planos de execução criados durante tarefas maiores.

## Arquitetura inicial

- Frontend: Next.js + React + TypeScript
- Backend: NestJS + TypeScript
- Banco: PostgreSQL
- ORM: Prisma
- Cache/locks/jobs: Redis
- Jobs: BullMQ
- Tempo real: WebSocket
- Storage: S3 compatível
- Monorepo: pnpm + Turborepo
- Deploy: Docker

## Ordem recomendada

Não iniciar pela IA.

A ordem inicial deve ser:

1. Estrutura do monorepo
2. Banco e migrations
3. Autenticação
4. Multi-tenancy
5. Usuários e permissões
6. Clínicas e unidades
7. Pacientes e contatos
8. Profissionais, especialidades e serviços
9. Agenda
10. Conversas
11. WhatsApp
12. IA
13. Automações
14. Dashboards

## Regra para alterações

Toda mudança que alterar comportamento de negócio, segurança, arquitetura ou modelo de dados deve atualizar a documentação correspondente.

## Desenvolvimento local — TASK-001

Requer Node.js 22 e Corepack (`corepack enable`). O `packageManager` fixa pnpm 10.

```sh
pnpm install
pnpm dev
```

Web: http://localhost:3000. API: http://localhost:3001/health.
O worker inicializa um contexto NestJS sem filas ou integrações. Encerre com Ctrl+C.

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm format` aplica a formatação. Turborepo compila os pacotes compartilhados
antes dos consumidores, inclusive ao executar `pnpm dev` pela primeira vez. Ao editar um pacote compartilhado, execute `pnpm build` novamente.

### Docker local

Com Docker Engine/Docker Desktop ativo:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose logs -f
docker compose down
```

Os containers usam modo desenvolvimento e portas vinculadas a localhost.
Após editar arquivos, reconstrua com `docker compose up --build -d`.
Configure o `.env` conforme a seção de banco abaixo antes de usar Compose.
As variáveis de integrações externas permanecem sem uso.

Os pacotes `domain` e `types` permanecem reservados. O pacote `database` contém
a infraestrutura Prisma, sem operações de negócio expostas. Nenhuma rota acessa dados de pacientes ou tenants. Autorização e
isolamento deverão ser implementados e testados no backend antes de expor essas
operações, conforme `docs/security.md` e a sequência do backlog.

## Banco local — TASK-002

Requer Docker ativo. Copie `.env.example` para `.env` se esse arquivo ainda não
existir. Defina uma senha local aleatória em `POSTGRES_PASSWORD` e use a mesma
senha na `DATABASE_URL` (codificada para URL quando necessário). Nunca versione
`.env`.

```sh
pnpm install
pnpm db:generate
pnpm db:validate
docker compose up -d --wait postgres
pnpm db:migrate
pnpm db:seed
```

A URL usada pelos comandos no host aponta para `localhost:5432`; em containers,
o hostname é `postgres`. API e worker ainda não consomem banco. Se mudar
`POSTGRES_PORT`, ajuste também `DATABASE_URL`. Alterar senha no `.env` não altera
a senha de um volume PostgreSQL já inicializado.

`db:migrate` aplica apenas migrations versionadas. Para criar uma migration em
desenvolvimento, use `pnpm db:migrate:dev --name nome_da_mudanca --create-only`,
revise o SQL e depois aplique `pnpm db:migrate`. Não use `db push` como substituto
de migrations. Não execute reset no banco de desenvolvimento compartilhado.

O seed exige `NODE_ENV=development`, cria apenas clínica/unidade fictícias e pode
ser repetido sem duplicar ou sobrescrever registros existentes. Não cria usuários
ou pacientes. Geração e build não acessam o banco; migrate e seed são explícitos.
O client Prisma é infraestrutura de backend, nunca uma interface para IA/frontend.

```sh
pnpm test       # testes sem banco
pnpm db:test    # PostgreSQL descartável: migrations do zero e testes reais
```

`db:test` cria um container exclusivo com senha aleatória e porta disponível,
aplica a migration duas vezes, executa o seed duas vezes e verifica constraints,
UUIDs, timestamps e consultas compostas por tenant. Ao finalizar, remove esse
container; não altera o volume de desenvolvimento. Requer acesso à imagem
`postgres:17-bookworm` na primeira execução.

O volume `postgres_data` preserva dados após `docker compose down`. Não use
`docker compose down -v` se precisar preservar o banco.
