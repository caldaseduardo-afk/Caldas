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
o hostname é `postgres`. A API usa o banco para autenticação; o worker ainda não consome banco. Se mudar
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

## Autenticação — TASK-003

Antes de iniciar a API, aplique `pnpm db:migrate`. No `.env`, configure
`AUTH_SECRET` com pelo menos 32 caracteres aleatórios e `AUTH_ORIGIN` com a origem
exata do frontend (local: `http://localhost:3000`). Não inclua barra final ou caminho.
Em produção, configure `NODE_ENV=production` e uma origem HTTPS. O Compose local
já passa a conexão interna com hostname `postgres` à API.

Para criar uma identidade local, preencha temporariamente no `.env` (ignorado):
`AUTH_BOOTSTRAP_EMAIL`, `AUTH_BOOTSTRAP_NAME` e `AUTH_BOOTSTRAP_PASSWORD`, com
senha de 12–128 caracteres, e execute `pnpm auth:create-user`. O comando exige
`NODE_ENV=development`, não sobrescreve usuários existentes, registra auditoria e
não atribui tenant ou papel. Remova a senha temporária do `.env` após o comando.
O seed da TASK-002 continua sem criar usuários ou senhas padrão.

Endpoints da API:

| Método | Rota         | Comportamento                                           |
| ------ | ------------ | ------------------------------------------------------- |
| POST   | /auth/login  | JSON com email/password; cria cookie de sessão          |
| GET    | /auth/me     | Exige cookie; retorna somente id, nome e email próprios |
| POST   | /auth/logout | Exige cookie; revoga sessão e remove cookie             |
| GET    | /health      | Público                                                 |

Envie `Origin: http://localhost:3000` nos POSTs locais; em navegador use
`credentials: 'include'`. Não leia ou armazene o token em JavaScript/localStorage.
Login retorna 401 genérico para credenciais inválidas; ausência/expiração de sessão
retorna 401, origem incorreta retorna 403 e excesso de tentativas retorna 429.
A aplicação web ainda não contém tela de login.

`pnpm test` verifica hash, configuração, validação e proteção padrão sem banco.
`pnpm db:test` também executa os testes HTTP reais de login/logout, sessão,
expiração, MFA pendente, CSRF, rate limit concorrente e auditoria em PostgreSQL
isolado. MFA completo e RBAC permanecem fora desta entrega; sessão de tenant está descrita abaixo.

## Multi-tenancy — TASK-004

Aplique `pnpm db:migrate`. Tenant e a unidade de desenvolvimento continuam sendo
criados pelo seed da TASK-002. Após criar uma identidade pela TASK-003, configure
no `.env` local `TENANCY_USER_EMAIL` e `TENANCY_TENANT_ID` e execute
`pnpm tenancy:grant`. Para o tenant do seed, o ID é
`00000000-0000-4000-8000-000000000001`. O comando exige NODE_ENV=development,
registra auditoria e não modifica vínculos já existentes.

Depois do login, utilizando o cookie de sessão:

1. `GET /tenancy/tenants`: listar apenas tenants disponíveis para a identidade.
2. `POST /tenancy/active` com `{"tenantId":"UUID"}` e Origin configurada: selecionar.
3. `GET /tenancy/active`: conferir o tenant atual.
4. `GET /tenancy/units` ou `GET /tenancy/units/:id`: consultar metadados isolados.

Sem seleção ou com vínculo inativo, recursos por tenant retornam 403. Um ID de
recurso de outra clínica retorna 404. X-Tenant-ID e query parameters não escolhem
contexto. Cada sessão mantém sua própria seleção; um novo login começa sem tenant.
Não há CRUD de clínicas/unidades, UI de seleção ou RBAC nesta etapa.

`pnpm db:test` inclui testes explícitos de isolamento HTTP e de repositories com
PostgreSQL descartável, além das regressões de autenticação e migrations.

### RBAC (TASK-005)

Após aplicar migrations, execute `pnpm db:seed:rbac` para instalar a matriz de
permissões versionada. Esse comando não cria usuários nem tenants e não altera
vínculos; reaplicá-lo restaura as concessões do catálogo. O seed de desenvolvimento
(`pnpm db:seed`) também instala RBAC. Sem o catálogo, operações de negócio falham
fechado com 403. Reiniciar a API não executa seed.

Os perfis CLINIC_ADMIN, AGENT e DOCTOR usam a matriz em `docs/tenancy.md`.
SUPER_ADMIN/MANAGER permanecem sem privilégios. `tenancy:grant` concede AGENT
somente no ambiente de desenvolvimento e mantém auditoria. As leituras de tenant
ativo/unidades agora exigem tenant.view/unit.view, verificadas pelo backend.
Não há CRUD de clínicas/unidades nem gestão de papéis nesta etapa.

### Clínicas e unidades (TASK-006)

Após `pnpm db:migrate` e `pnpm db:seed:rbac`, a API oferece GET/PATCH/DELETE em
`/clinics/:id`, GET `/clinics` e POST/GET/PATCH/DELETE em `/units` (ID nos métodos
que operam uma unidade). Leituras exigem tenant.view/unit.view; escritas,
settings.manage. Todas usam o tenant selecionado. DELETE inativa e preserva dados.

Criação de nova clínica é local nesta etapa, pois a permissão de provisionamento
da plataforma não está definida e SUPER_ADMIN ainda depende de MFA:

```sh
NODE_ENV=development CLINIC_OWNER_EMAIL=admin@example.test CLINIC_NAME='Clínica local' CLINIC_TIMEZONE=America/Sao_Paulo pnpm clinics:create
```

O usuário deve existir (comando auth:create-user); o comando cria vínculo
CLINIC_ADMIN somente para a nova clínica. Não funciona em produção e não há POST
/clinics. Após login, selecione seu UUID via POST /tenancy/active.

Exemplo de corpo de POST /units: `{"name":"Centro","address":"Rua Exemplo, 10"}`.
active inicia true; timezoneOverride inicia null e herda o timezone da clínica.
PATCH permite alterações parciais; campos extras/tenantId são rejeitados.
Uma clínica inativada perde acesso e não pode ser reativada pela API atual.
Detalhes e decisões estão em `docs/exec-plans/TASK-006-clinics-units.md`.

### Contatos e canais (TASK-007)

Execute `pnpm db:migrate` e `pnpm db:seed:rbac`. CLINIC_ADMIN/AGENT possuem
contact.view/contact.edit; DOCTOR não possui acesso ao diretório.

Exemplo de POST /contacts, após login e seleção de tenant:

```json
{
  "displayName": "Contato de exemplo",
  "channels": [
    { "type": "PHONE", "address": "(61) 99999-9999", "primary": true },
    { "type": "WHATSAPP", "address": "+55 61 99999-9999" }
  ]
}
```

GET /contacts?phone=... normaliza o filtro e retorna contatos distintos do tenant.
Ao usar + na query, codifique como %2B (ou use URLSearchParams). GET /contacts/:id
inclui canais. PATCH /contacts/:id aceita displayName/status ACTIVE ou INACTIVE.
POST /contacts/:id/channels adiciona canal; PATCH /contacts/:id/channels/:channelId
aceita address, primary e providerExternalId. Definir primary=true desmarca o
anterior atomicamente. Não se pode simplesmente desmarcar o principal sem substituto.
Contatos sem canais são permitidos; o primeiro canal adicionado torna-se principal.

Telefones brasileiros com DDD são normalizados para +55: `(61) 99999-9999`,
`61 99999-9999` e `+55 61 99999-9999` viram `+5561999999999`. DDI 55 sem + também é
aceito com comprimento completo. Outros países exigem + e 8–15 dígitos; validação
é sintática. Ramais, prefixos de operadora, números locais sem DDD e letras são
rejeitados; não se acrescenta nono dígito nem se altera um número por inferência.
Não há consulta de operadora ou verificação de posse. Sem dependência externa.

Duplicidade de (tenant,tipo,telefone) ou (tenant,tipo,ID externo não nulo) retorna 409. Mesmo telefone pode existir em tenants distintos. PHONE e WHATSAPP são canais
diferentes; busca não funde pessoas. providerExternalId é opcional e seu namespace
inicial é o tipo de canal; provedores múltiplos serão tratados na tarefa específica.
A TASK-007 não implementa pacientes/representantes; veja TASK-008 abaixo.
Agenda, envio de mensagens e integração real continuam fora desta entrega.

### Pacientes e representantes (TASK-008)

Execute `pnpm db:migrate` e `pnpm db:seed:rbac`. Com sessão e tenant selecionado,
POST /patients recebe `{"name":"Lucas","birthDate":"2010-05-20"}`. GET /patients
lista resumos; GET/PATCH /patients/:id consulta/atualiza. O detalhe aceita ainda
document, healthPlan, paymentPreference e notes (opcionais e removíveis com null).

POST /patients/:patientId/relationships recebe
`{"contactId":"UUID-do-contato","relationshipType":"MOTHER"}` e inicia
DECLARED/NO_ACCESS. Use SELF quando o contato também for o paciente, mantendo o
mesmo Contact. GET nesse caminho lista vínculos, inclusive revogados. PATCH
/:id altera política/principal; `isPrimaryContact:true` troca o principal na mesma
transação. POST /:id/revoke revoga e preserva histórico. Revogação é terminal
nesta entrega. GET /contacts/:contactId/patient-links lista os vínculos do contato.

Somente CLINIC_ADMIN possui patient.authorize para verificar, conceder níveis de
acesso ou afirmar representante legal. AGENT pode declarar NO_ACCESS e revogar.
GET /contacts/:contactId/patients/:patientId só retorna id/name/birthDate com
vínculo ativo VERIFIED/FULL e contato ativo, além de patient.view/contact.view.
DECLARED/SCHEDULING_ONLY é válido, mas não libera essa consulta. Não há operação
de agenda nem autenticação pública de contato. PatientAccessService prepara o
futuro active_patient_id sem criar Conversation. Veja o plano TASK-008 e docs/security.md.
