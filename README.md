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

### Especialidades e serviços (TASK-009)

Após `pnpm db:migrate`, use sessão com tenant selecionado e service.manage
(CLINIC_ADMIN). POST/GET /specialties cria/lista áreas; GET/PATCH /specialties/:id
consulta/altera. Exemplo de criação: `{"name":"Cardiologia"}`.

POST/GET /services cria/lista atendimentos concretos; GET/PATCH /services/:id
consulta/altera. Exemplo de criação:

```json
{
  "specialtyId": "UUID-da-especialidade",
  "name": "Primeira consulta",
  "description": "Consulta inicial",
  "durationMinutes": 30,
  "bufferBeforeMinutes": 5,
  "bufferAfterMinutes": 10,
  "price": "150.10"
}
```

Preço é string decimal (Decimal(12,2)), com até duas casas; null remove o valor.
Não envie número JSON. Buffers omitidos são zero; preço/descrição omitidos são null.
Use PATCH `{"active":false}` para inativar e true para ativar. Registros permanecem
no banco; não existe DELETE. A especialidade pode ser alterada pelo specialtyId,
sempre dentro do tenant e respeitando unicidade do nome no destino.

GET /specialties?active=true e GET /services?active=false filtram atividade.
GET /services?specialtyId=UUID&active=true lista serviços da especialidade.
Sem filtro, inclui inativos. Nomes únicos por tenant/especialidade usam comparação
exata após trim. Especialidade não é item agendável; agenda e profissionais não
foram implementados. Inativar área não altera o estado dos serviços em cascata.
Detalhes estão em docs/exec-plans/TASK-009-specialties-services.md.

### Profissionais (TASK-010)

Execute `pnpm db:migrate`. Com sessão e tenant ativo, CLINIC_ADMIN pode criar:

```json
{
  "name": "Dr. João",
  "professionalType": "DENTIST",
  "registrationNumber": "CRO-DF/ABC-001"
}
```

POST /providers cria; GET /providers lista; GET/PATCH /providers/:id consulta/altera.
Tipo profissional é texto extensível; registro é texto opcional, sem validação de
conselho. PATCH `{"active":false}` inativa e true reativa, preservando vínculos.

POST /providers/:providerId/services recebe `{"serviceId":"UUID"}`. Opcionalmente,
inclua `durationOverrideMinutes:45` e `priceOverride:"150.10"`. Overrides ausentes
ficam null, sem copiar defaults do Service; null no PATCH remove a exceção. Preço
zero é válido e mantém precisão decimal. GET no mesmo caminho lista vínculos,
overrides e resumo atual do Service. PATCH /providers/:providerId/services/:id
altera overrides/active; :id identifica o vínculo, não o Service.

POST /providers/:providerId/units recebe `{"unitId":"UUID"}`. GET lista vínculos e
resumos de unidades; PATCH /providers/:providerId/units/:id altera active. Um
profissional pode ter vários serviços e unidades, todos do mesmo tenant. Não há
DELETE; inativação mantém os vínculos e sua unicidade. IDs relacionados não mudam
por PATCH. As três listas administrativas aceitam `?active=true` ou `?active=false`.

GET /services/:serviceId/providers retorna profissionais habilitados no cadastro:
Provider, Service e ProviderService ativos. Serviço inativo retorna lista vazia;
externo/inexistente, 404. Não calcula horários/disponibilidade nem filtra unidade.
Cadastro exige provider.manage; vínculos/consulta de serviços exigem também
service.manage; vínculos de unidades, unit.view. Plano e limites em
docs/exec-plans/TASK-010-providers.md. TASK-011 não está implementada.

### Disponibilidade estrutural (TASK-011)

Execute `pnpm db:migrate`. A migration utiliza a extensão PostgreSQL btree_gist
para impedir sobreposição também no banco. Com sessão, tenant ativo e permissões
provider.manage + unit.view, POST /availability-rules aceita:

```json
{
  "providerId": "UUID-do-profissional",
  "unitId": "UUID-da-unidade",
  "weekday": "MONDAY",
  "startTime": "08:00",
  "endTime": "12:00",
  "validFrom": "2026-10-01",
  "validUntil": "2026-12-31"
}
```

Crie outra regra para 14:00–18:00. Provider deve ter vínculo ProviderUnit na unidade;
configuração ativa exige vínculo ativo. GET /availability-rules lista;
GET/PATCH /availability-rules/:id consulta/altera. PATCH active=false/true inativa/
ativa sem exclusão. ProviderId/unitId não mudam por PATCH. Listagens aceitam
providerId, unitId e active=true/false.

POST /schedule-exceptions recebe providerId/unitId/date/type, reason opcional e
startTime/endTime opcionais. BLOCK/MEETING/etc com 10:00–11:00 dividem 08:00–12:00
em 08:00–10:00 e 11:00–12:00. VACATION/HOLIDAY sem horários bloqueiam o dia inteiro;
EXTRA_AVAILABILITY exige horários e adiciona períodos mesmo sem regra semanal.
Bloqueios prevalecem sobre extras. GET lista, GET/PATCH /schedule-exceptions/:id
consulta/altera; filtros incluem dateFrom/dateUntil inclusivos, além de providerId,
unitId e active. Para limpar horários em PATCH, envie ambos como null.

GET /providers/:providerId/availability?unitId=UUID&date=2026-10-12 retorna:

```json
{
  "date": "2026-10-12",
  "timezone": "America/Sao_Paulo",
  "windows": [{ "start": "08:00", "end": "12:00" }]
}
```

Date é civil e horários são locais à unidade (override ou timezone da clínica),
sem depender do navegador/host. A resposta representa janelas estruturais, não
slots UTC ou horários confirmáveis. Tratamento de DST na conversão para instantes,
consultas existentes, HOLDs, duração e buffers serão compostos nas próximas tarefas.
Plano: docs/exec-plans/TASK-011-availability.md. TASK-012 não implementada.

### HOLD (TASK-012)

Após `pnpm db:migrate`, iniciar API e worker com a configuração de `.env.example`.
O worker agora usa PostgreSQL para expirar reservas; não depende de Redis para
integridade. `HOLD_TTL_SECONDS` (1–86400, padrão 300) configura validade e
`HOLD_SWEEP_INTERVAL_MS` (1–3600000, padrão 30000) configura a varredura.

Rotas autenticadas no tenant ativo:

- `POST /appointment-holds`: requestId, patientId, serviceId, providerId, unitId,
  startAt com offset; contactId e endAt opcionais. endAt é asserção do cálculo backend.
- `GET /appointment-holds/:id`: consulta da reserva.
- `GET /appointment-holds/active?providerId=...&unitId=...&startAt=...&endAt=...`:
  resumos ativos no intervalo (até 31 dias).
- `POST /appointment-holds/:id/release`: liberação idempotente.

Criação exige appointment.create, patient.view e unit.view; consulta exige
appointment.view e patient.view; liberação exige appointment.cancel e patient.view.
Contact informado exige contact.view e vínculo VERIFIED ativo com permissão
FULL/SCHEDULING_ONLY para o paciente. Tenant vem da sessão, nunca do payload.
Detalhes e limites: [plano TASK-012](docs/exec-plans/TASK-012-appointment-hold.md).

### Consultas (TASK-013)

Aplicar `pnpm db:migrate` antes de iniciar a API. Rotas no tenant da sessão:

- `POST /appointments`: patientId, providerId, serviceId, unitId, startAt com offset;
  contactId/endAt/source/notes opcionais. source MANUAL (default), PHONE ou WEB.
- `POST /appointments/from-hold`: holdId, source/notes opcionais.
- `GET /appointments`: startAt/endAt obrigatórios (até 31 dias); filtros opcionais
  providerId/unitId/patientId/status. Lista resumos, sem notas/autoria.
- `GET /appointments/:id`: detalhe administrativo.
- `POST /appointments/:id/cancel`: reason opcional; preserva consulta.
- `POST /appointments/:id/reschedule`: providerId/serviceId/unitId/startAt; endAt,
  source/notes opcionais; Patient/Contact originais são preservados.
- `POST /appointments/:id/status`: status CONFIRMED/CHECKED_IN/COMPLETED/NO_SHOW.

Criação/conversão exige appointment.create + patient.view + unit.view; leitura
appointment.view + patient.view; cancelamento appointment.cancel + patient.view;
remarcação appointment.reschedule + patient.view + unit.view. Transições exigem
appointment.create + patient.view; não ampliam permissões do DOCTOR. Contact exige
contact.view e relação elegível para agendamento. Nenhuma autorização no frontend.

Detalhes de transações, concorrência e limites no
[plano TASK-013](docs/exec-plans/TASK-013-appointments.md).

### Notification Rules (TASK-014)

Aplicar `pnpm db:migrate`. Configuração exige settings.manage no tenant ativo;
cálculo por consulta também exige appointment.view e patient.view.

- `POST /notification-rules`: type, offsetMinutes, allowedStartTime/allowedEndTime
  (HH:mm), allowedWeekdays e outsideWindowPolicy obrigatórios; retryEnabled,
  retryAfterMinutes, maxAttempts, minimumTimeBeforeAppointment, actionIfNoResponse,
  active opcionais.
- `GET /notification-rules`: filtros opcionais type/active.
- `GET /notification-rules/:id`: consulta.
- `PATCH /notification-rules/:id`: configuração e ativação/inativação.
- `POST /notification-rules/:id/preview`: appointmentStart com offset e unitId
  opcional. Timezone vem da unidade/clínica.
- `POST /notification-rules/:id/resolve`: appointmentId no tenant atual.

Preview e resolve aceitam previousAttemptAt/attemptNumber em par para retry teórico.
Retornam decision SCHEDULE/SKIP, scheduledAt ISO UTC ou null, reason estruturado.
Nenhuma dessas rotas envia mensagens ou executa actionIfNoResponse.

Contrato temporal, limites e testes no
[plano TASK-014](docs/exec-plans/TASK-014-notification-rules.md).

### Conversas (TASK-015)

Aplicar `pnpm db:migrate`. Rotas no tenant ativo:

- `POST /conversations`: contactId, channel opcional (WHATSAPP). Obtém/cria aberta,
  retorna 200 nas duas situações.
- `GET /conversations`: page/limit e filtros status/intent/assignedUserId/contactId/
  activePatientId/channel.
- `GET /conversations/:id`: contexto sem dados clínicos expandidos.
- `PATCH /conversations/:id`: activePatientId (UUID/null) e/ou intent.
- `POST /conversations/:id/status`: status e handoffReason quando NEEDS_HUMAN.
- `POST /conversations/:id/messages`: messageType, content, metadata conforme tipo;
  autoria USER determinada pela sessão. Apenas persiste, sem enviar.
- `GET /conversations/:id/messages`: page/limit, ordem cronológica estável.
- `GET /conversations/:id/messages/:messageId`: consulta da mensagem.

Leitura exige conversation.view/contact.view; escrita acrescenta conversation.reply.
Resolver/fechar exige conversation.close; selecionar paciente exige patient.view;
retorno do humano para IA exige conversation.transfer. Atribuição HUMAN_ACTIVE,
ingresso PATIENT, AI/SYSTEM e recibos são operações internas, sem rota pública,
e continuam exigindo contexto autorizado. Não há integração nem lock de atendente.

Listas retornam items/page/limit/hasMore, com limite100 e offset10000.
Detalhes: [plano TASK-015](docs/exec-plans/TASK-015-conversations.md).

## Inbox Web — TASK-016

Abra `/conversations` no frontend (local: `http://localhost:3000/conversations`).
Entre com usuário já provisionado e selecione explicitamente uma clínica do seu
vínculo. A inbox exige `conversation.view` e `contact.view`; permissões adicionais
controlam contexto de pacientes, próxima consulta e composição. Não há cadastro
público nem concessão de permissões pela interface.

O proxy Next usa `API_INTERNAL_URL` no servidor (padrão `http://localhost:3001`;
Docker: `http://api:3001`). `AUTH_ORIGIN` da API deve corresponder à origem pública
do frontend. Cookies HttpOnly e Origin são encaminhados sem transformar uma origem
não confiável em confiável. Respostas autenticadas não são armazenadas em cache.

A lista tem busca no banco e paginação; a URL mantém `conversationId`. O histórico
abre pelas últimas 30 mensagens, com botão para anteriores. A atualização manual
é complementada pelo WebSocket da TASK-017 abaixo.
O composer **somente persiste a mensagem localmente**, sem envio ao WhatsApp.
Não há contador de não lidas, anexos disponíveis ou handoff nesta etapa.

Testes de navegador, isolados com fixtures exclusivamente de teste:

```sh
pnpm --filter @atendente/web exec playwright install chromium
pnpm --filter @atendente/web test:e2e
```

A autorização real, queries, cursores e isolamento são testados contra PostgreSQL
por `pnpm db:test`. Testes unitários do proxy verificam cookie, Origin, limite de
payload e erros sanitizados. Execute as validações de workspace sequencialmente:
`test` e `typecheck` compartilham geração do Prisma e não devem concorrer entre si.

## WebSocket — TASK-017

A Inbox agora atualiza conversas e mensagens automaticamente, sem recarregar a
aplicação. O rodapé informa conexão/reconexão; **Atualizar inbox** e operações REST
continuam disponíveis durante falha do WebSocket. Não há envio real ao WhatsApp.

O navegador conecta à própria origem em `/realtime`, com o cookie existente. Next
encaminha o upgrade para `API_INTERNAL_URL`; Docker já configura `http://api:3001`.
Para produção, defina essa URL antes do build (rewrite faz parte do artefato) ou
configure o proxy público para encaminhar `/realtime` diretamente à API. Preserve
Cookie/Origin e permita Upgrade; AUTH_ORIGIN deve ser a origem pública do frontend.
Não é necessário expor porta/URL adicional nem token ao JavaScript.

Uma instância da API nesta etapa. Não há Redis adapter nem entrega durável/replay:
reconectar refaz as leituras canônicas, recuperando eventos perdidos. Logout/troca
de tenant fecha as conexões da sessão; permissões também são revalidadas antes de
cada envio e no heartbeat. Sem handoff/lock/typing/presença ou TASK-018.

`pnpm db:test` inclui testes com PostgreSQL, sockets reais e upgrade através do
Next (porta de teste 3199). `pnpm --filter @atendente/web test:e2e` inclui duas
janelas, reconexão e cleanup com transporte controlado em fixtures de teste.
Execute essas duas suítes sequencialmente, pois ambas usam o Next de desenvolvimento.

### SLA humano (TASK-019)

Aplicar `pnpm db:migrate`, configurar `REDIS_URL` no `.env` e iniciar Redis
(`docker compose up -d redis`) e o worker (`pnpm --filter @atendente/worker dev`).
API usa a mesma URL para receber conclusões dos jobs e atualizar a Inbox. Com
Compose completo, API/worker apontam para `redis:6379`; processos locais usam a
porta publicada. Se 6379 estiver ocupada, ajustar REDIS_PORT e a porta da REDIS_URL
local em conjunto.

CLINIC_ADMIN configura uma regra em POST /human-sla-rules, por exemplo:
`{"firstAlertMinutes":5,"secondAlertMinutes":10,"externalAlertMinutes":15,"internalAlertEnabled":true,"externalAlertEnabled":true,"active":true}`.
São valores de exemplo, não defaults do domínio. GET/PATCH usam o ID retornado;
POST /human-sla-rules/:id/preview recebe requestedAt com timezone explícito.
Sem regra ativa, handoff funciona sem alertas automáticos. Alterar tempos afeta
ciclos novos; desativar cancela ciclos existentes. Externo é somente evento requerido,
sem envio real. `pnpm db:test` cria PostgreSQL e Redis isolados e testa jobs reais.

### WhatsApp oficial (TASK-020 — comportamento vigente)

As seções anteriores descrevem entregas históricas. Nesta versão, conversas vinculadas a
Integration enviam texto pelo WhatsApp oficial; conversas antigas sem vínculo continuam
locais. Não há IA ou resposta automática.

1. Aplicar `pnpm db:migrate`. Iniciar PostgreSQL e Redis conforme configuração existente.
2. Configurar `WHATSAPP_GRAPH_VERSION` com versão suportada pela aplicação Meta,
   `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` na API. Worker precisa da versão e dos
   access tokens `WHATSAPP_ACCESS_TOKEN_<ALIAS>`, injetados pelo ambiente/secret manager.
   Sem versão, o worker não inicia o consumidor WhatsApp; SLA/HOLD continuam funcionando.
3. Operador autorizado confirma titularidade do número e configura no ambiente do comando
   `WHATSAPP_TENANT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
   `WHATSAPP_CREDENTIALS_REFERENCE` (nome da variável de token, por exemplo
   WHATSAPP_ACCESS_TOKEN_DEFAULT) e o token correspondente. Executar `pnpm whatsapp:configure`.
   `WHATSAPP_INTEGRATION_STATUS` aceita ACTIVE/DISABLED; vazio usa ACTIVE. Repetir por número.
   Essas variáveis de provisionamento não identificam tenant de requests.
4. Expor a API via HTTPS no callback `/webhooks/whatsapp`, cadastrar verify token e assinar
   eventos messages da WABA na Meta. GET verifica challenge; POST exige assinatura app secret.
   O proxy Next da Inbox não expõe esse webhook: encaminhar callback diretamente à API.
5. Iniciar API/web/worker atualizados. Receber mensagem cria/reutiliza Contact e Conversation;
   assumir pela Inbox antes de responder. O botão integrado registra intenção e mostra
   PENDING/SENT/DELIVERED/READ/FAILED conforme persistência/provider/recibos.

Compose encaminha app secret/verify token à API e WHATSAPP_ACCESS_TOKEN_DEFAULT ao worker.
Para múltiplas referências no Docker, injetar explicitamente as variáveis adicionais no
worker por override/secret manager. Nunca expor segredo em variável NEXT_PUBLIC ou comando
com token literal. Mudanças de código exigem reconstruir imagens quando usar Compose.

Homologação local usa provider HTTP simulado e PostgreSQL/Redis/BullMQ/WebSocket reais,
sem enviar mensagens externas. A conexão real exige credenciais, conta/número Meta e
callback público configurados pelo operador. Não há download de mídia, templates,
transcrição ou notificações automáticas. Falha de resultado incerto não faz reenvio cego.
Contrato completo: [integrações](docs/integrations.md) e
[plano TASK-020](docs/exec-plans/TASK-020-whatsapp-provider.md).

### AI Provider (TASK-021)

Base interna de inferência via `AIService`/`AIProvider`, sem endpoint público ou resposta
automática a conversas. Configure as variáveis OPENAI_* de `.env.example` para primeiro
uso; sem elas a API administrativa continua disponível. Modelo é obrigatório e deve
suportar Responses API; temperature fica omitida por padrão. Docker repassa configuração
somente à API. Nunca colocar chave no código ou frontend.

`pnpm test` usa HTTP simulado no SDK; `pnpm db:test` cobre consumo e isolamento com banco
isolado. Não há teste pago nem necessidade de chave real. Consumo fica em AIUsage sem
conteúdo; custo permanece desconhecido/null. Consulte [decisões e limitações](docs/exec-plans/TASK-021-ai-provider.md)
e [contrato de integração](docs/integrations.md#ai-provider--task-021).

### Tool Gateway (TASK-022)

`ToolGateway` é um serviço interno sem endpoint HTTP. `beginTurn` deriva contexto de uma
sessão autenticada e Conversation; `executeTool` valida registry, schema, contexto, RBAC,
vínculo e intenção antes de chamar serviços de domínio. Ator AI não possui usuário falso
ou bypass administrativo. AIProvider não despacha ferramentas automaticamente.

Há dez tools de contexto, catálogo, slots, HOLD, consultas e handoff. Aprovações de
cancelamento/remarcação/confirmação vêm do código chamador confiável e correspondem ao
payload exato; nunca de argumentos da IA. Orçamentos TOOL_* estão em `.env.example`.
Resultados mutáveis usam ledger para replay; RUNNING após crash exige reconciliação,
sem retry cego. Veja [plano e inventário](docs/exec-plans/TASK-022-tool-gateway.md),
[segurança](docs/security.md#tool-gateway--task-022) e [contrato](docs/integrations.md#tool-gateway--task-022).
