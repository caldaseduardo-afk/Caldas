# Multi-Tenancy, Usuários e Permissões

## 1. Tenant

Cada clínica é um tenant.

Uma clínica pode possuir várias unidades.

## 2. Usuários

Um usuário pode pertencer a mais de um tenant.

Usar relação `USER_TENANT`.

## 3. Perfis

- SUPER_ADMIN
- CLINIC_ADMIN
- AGENT
- DOCTOR
- MANAGER futuro

## 4. Permissões

Permissões iniciais:

```text
conversation.view
conversation.reply
conversation.assign
conversation.transfer
conversation.close

patient.view
patient.edit

appointment.view
appointment.create
appointment.reschedule
appointment.cancel

provider.manage
service.manage

user.manage
settings.manage
analytics.view
billing.view
```

## 5. Unidades

Usuários podem ter escopo por unidade.

## 6. SUPER_ADMIN

O SUPER_ADMIN opera fora do contexto normal de clínica, mas toda operação sobre dados de tenant deve ser explicitamente selecionada e auditada.

Não existe bypass global. Para suporte administrativo, o SUPER_ADMIN inicia
explicitamente um grant temporário sobre uma clínica ativa, com motivo e sessão
de plataforma válida. O AuthGuard valida esse grant por requisição e preenche um
TenantScope limitado à clínica selecionada. TenantContext e repositories continuam
filtrando por tenant; a validação do grant substitui apenas o vínculo UserTenant
ausente, nunca o filtro do recurso/tenant. O RBAC aplica as permissões
CLINIC_ADMIN. O grant não cria membership nem identidade clínica e cada leitura e
escrita é auditada como PLATFORM_ADMIN real. O modo expira em 30 minutos, pode ser
encerrado e é revogado no logout de plataforma.

## 7. Troca de tenant

Quando usuário pertence a múltiplas clínicas:

1. autentica;
2. recebe lista de tenants;
3. seleciona tenant;
4. tenant ativo entra na sessão/contexto;
5. toda operação usa esse tenant.

## 8. Testes

Criar suíte explícita de segurança multi-tenant.

Ela deve ser executada continuamente.

## Implementação inicial — TASK-004

Tenant é reutilizado da TASK-002. Seu estado `ACTIVE` permite contexto; qualquer
outro valor bloqueia acesso. UserTenant possui chave composta (user_id, tenant_id),
role obrigatório informativo, active e timestamps. O role não decide permissões
nesta etapa, inclusive quando contém SUPER_ADMIN. RBAC permanece na TASK-005.

O login da TASK-003 cria sessão sem tenant. A pessoa autenticada consulta
`GET /tenancy/tenants` e solicita seleção por `POST /tenancy/active` com JSON
`{"tenantId":"UUID"}`. O backend valida vínculo/tenant ativos antes de alterar
somente aquela sessão. A seleção é auditada atomicamente com user_id/tenant_id.
Não há tenant padrão nem seleção automática pelo primeiro vínculo.

`GET /tenancy/active` retorna id/nome/timezone do tenant atual. As rotas
`GET /tenancy/units` e `GET /tenancy/units/:id` retornam apenas id/tenantId/name
para verificar o limite de acesso sobre um recurso existente. CRUD de unidades
continua na TASK-006; não há escrita por HTTP nesta entrega.

O AuthGuard preenche identidade, ID da sessão e snapshot do tenant a partir do
banco. TenantContext e TenantGuard têm escopo por requisição. O guard exige tenant
por padrão; apenas rotas públicas, de identidade e de listagem/seleção possuem
exceção explícita. Nenhum header, query ou campo arbitrário estabelece contexto.
O campo tenantId no POST representa uma solicitação, nunca autorização.

Services exigem contexto e repositories repetem a validação. As consultas também
incluem tenant_id, vínculo ativo, sessão válida no mesmo tenant e usuário habilitado.
Se o tenant da sessão mudar após a captura do snapshot, o contexto antigo falha
fechado; não muda silenciosamente de clínica. Não há cache de autorização entre
requisições. Os filtros evitam vazamento mesmo se o vínculo for revogado entre
uma validação e a consulta ao recurso.

A FK composta de AuthSession para UserTenant impede seleção de vínculo de outro
usuário. Remover o vínculo elimina suas sessões selecionadas; desativá-lo bloqueia
acesso nas consultas seguintes. Identidade/listagem/seleção/logout permanecem
acessíveis para recuperar contexto quando o vínculo foi desativado.

Sem seleção ou vínculo ativo: 403. Recurso de outro tenant ou inexistente: 404.
Duas sessões do mesmo usuário podem selecionar tenants diferentes.

Para desenvolvimento, `pnpm tenancy:grant` cria vínculo para o usuário e tenant
existentes informados via TENANCY_USER_EMAIL e TENANCY_TENANT_ID. Não reativa vínculo
revogado, não altera vínculo existente e não seleciona nenhuma sessão. O metadado
role inicial é AGENT, sem implementar permissões. Não há concessão pública via API.

## RBAC — TASK-005

A política abaixo substitui o role meramente informativo da TASK-004. O catálogo
é global; a concessão ao usuário é sempre o role de UserTenant **do tenant ativo**.
Não há herança entre vínculos, permissões wildcard ou bypass de tenant.

| Permissões                                        | CLINIC_ADMIN | AGENT | DOCTOR |
| ------------------------------------------------- | ------------ | ----- | ------ |
| tenant.view, unit.view (metadados existentes)     | Sim          | Sim   | Sim    |
| conversation.view, reply, assign, transfer, close | Sim          | Sim   | Não    |
| patient.view                                      | Sim          | Sim   | Sim    |
| patient.edit                                      | Sim          | Sim   | Não    |
| appointment.view                                  | Sim          | Sim   | Sim    |
| appointment.create, reschedule, cancel            | Sim          | Sim   | Não    |
| provider.manage, service.manage                   | Sim          | Não   | Não    |
| user.manage, settings.manage                      | Sim          | Não   | Não    |
| analytics.view, billing.view                      | Sim          | Não   | Não    |

Na tabela, operações abreviadas mantêm o prefixo do recurso. A matriz foi
explicitada durante a TASK-005 e adotada após a instrução de continuar. SUPER_ADMIN
não recebe concessões nem ativa capacidade administrativa: MFA completo e módulo
de plataforma continuam futuros. MANAGER é reservado, sem concessões. Mesmo se
alguém inserir permissões para esses papéis no banco, o backend bloqueia seu uso.
Papéis legados desconhecidos são preservados desabilitados e não podem autorizar.

`GET /tenancy/active` exige tenant.view; `GET /tenancy/units` e
`GET /tenancy/units/:id` exigem unit.view. Rotas de identidade, logout e seleção
possuem exceção explícita IdentityOnly; isso não dispensa autenticação, CSRF nem
validação do vínculo na seleção. Rotas públicas existentes continuam públicas.
Toda outra rota sem política explícita é negada. RequirePermissions exige todas
as permissões declaradas, somando exigências de classe e método.

Services e repositories usam AuthorizationService; os filtros SQL dos recursos
incluem sessão/contexto e role habilitado com todas as permissões exigidas.
Revogar role, permissão ou vínculo passa a valer sem novo login. O frontend não
participa da decisão. Sem permissão: 403; com permissão e ID externo/inexistente: 404. Permissões clínicas são apenas catálogo nesta etapa: nenhum endpoint clínico
ou CRUD de unidades foi criado. Escopo por unidade e relação contato/paciente
continuam requisitos das tarefas desses recursos, além do RBAC.

`pnpm db:seed:rbac` reaplica transacionalmente o catálogo versionado, sem criar
clínicas/usuários ou alterar UserTenant. Reexecução restaura as associações da
matriz; não usar o seed como processo periódico para sobrepor revogações manuais.
A API nunca o executa ao iniciar. `pnpm db:seed` de desenvolvimento também o inclui.
O comando local tenancy:grant continua fixo em AGENT e agora concede as permissões
desse papel, com o evento de auditoria existente. Não existe API de concessão,
troca de papel ou alteração da matriz nesta tarefa.

## Clínicas e unidades — TASK-006

A clínica continua sendo Tenant. Os endpoints abaixo operam exclusivamente no
tenant selecionado na sessão; ter vínculo com outra clínica não permite acessá-la
por ID antes de selecioná-la. A lista /tenancy/tenants serve para trocar contexto.

| Endpoint            | Permissão       | Resultado                                     |
| ------------------- | --------------- | --------------------------------------------- |
| GET /clinics        | tenant.view     | Clínica selecionada (lista)                   |
| GET /clinics/:id    | tenant.view     | Clínica selecionada, ou 404                   |
| PATCH /clinics/:id  | settings.manage | Altera nome, timezone e/ou status             |
| DELETE /clinics/:id | settings.manage | Inativa a clínica                             |
| POST /units         | settings.manage | Cria unidade no tenant da sessão              |
| GET /units          | unit.view       | Lista unidades da clínica, inclusive inativas |
| GET /units/:id      | unit.view       | Consulta unidade da clínica                   |
| PATCH /units/:id    | settings.manage | Altera campos permitidos da unidade           |
| DELETE /units/:id   | settings.manage | Inativa a unidade                             |

Leitura de unidades inclui name, address, active, timezoneOverride e
effectiveTimezone (override ou timezone da clínica), além de IDs/timestamps.
POST/PATCH retornam o registro persistido; GET calcula o timezone efetivo.
As rotas de metadados /tenancy/units e /tenancy/units/:id mantêm o contrato anterior
e reutilizam o repository de unidades. Não há endpoints de escrita nesse prefixo.

DTOs aceitam somente campos conhecidos: nomes até 200 caracteres, endereço até
2000, timezone IANA válido (ou UTC). Em unidade, active é booleano e
timezoneOverride pode ser null para herdar. tenantId/IDs/role/timestamps nunca
podem ser enviados para definir contexto ou mover unidade. PATCH vazio é inválido.

DELETE não exclui linhas. Unidade pode ser reativada por PATCH active=true. Clínica
aceita ACTIVE/INACTIVE na API, e inativá-la bloqueia imediatamente seu contexto,
conforme TASK-004. A API atual não reativa clínicas inativas nem contorna o guard;
recuperação de uma clínica inativada depende de administração da plataforma.
Histórico e unidades permanecem persistidos. Outros tenants não são afetados.

### Provisionamento inicial de clínica

A documentação não concede criação de novas clínicas a CLINIC_ADMIN. SUPER_ADMIN
continua indisponível até MFA completo. Assim, a implementação mínima mantém
criação exclusivamente no comando local `pnpm clinics:create`, com
NODE_ENV=development e variáveis CLINIC_OWNER_EMAIL, CLINIC_NAME e CLINIC_TIMEZONE.
O proprietário deve ser usuário ativo já existente e o seed RBAC deve estar
aplicado. O comando cria uma nova clínica ACTIVE e seu vínculo CLINIC_ADMIN,
registra eventos e retorna seu UUID. Cada execução cria uma clínica nova; não é
seed idempotente. Não seleciona sessão, não modifica clínicas existentes e não
funciona em produção. Não existe POST /clinics nesta etapa. Uma API de criação
exige definir a permissão de provisionamento de plataforma; nenhum privilégio foi
inferido a partir de settings.manage de uma clínica existente.

## Contatos — TASK-007

contact.view e contact.edit são permissões próprias para o diretório de contatos,
concedidas a CLINIC_ADMIN e AGENT. DOCTOR não recebe acesso ao diretório por possuir
patient.view: contato e paciente continuam conceitos separados. Perfis reservados
continuam sem concessões. O catálogo passa a 21 permissões (CLINIC_ADMIN 21,
AGENT 15, DOCTOR 4); aplicar `pnpm db:seed:rbac` após migration.

| Endpoint                                | Permissão    |
| --------------------------------------- | ------------ |
| GET /contacts e GET /contacts?phone=... | contact.view |
| GET /contacts/:id (inclui canais)       | contact.view |
| POST /contacts                          | contact.edit |
| PATCH /contacts/:id                     | contact.edit |
| POST /contacts/:id/channels             | contact.edit |
| PATCH /contacts/:id/channels/:channelId | contact.edit |

Todas as consultas/escritas usam o tenant da sessão e revalidam autorização no
repository. Mesmo telefone em tenants diferentes não conflita. Buscar número
existente somente em outro tenant retorna lista vazia; ID externo/inexistente
retorna o mesmo 404. Unicidade por tipo é local ao tenant, inclusive ID externo.
Conhecer ID de canal não permite usá-lo sob outro contato nem tenant.

GET /contacts admite somente phone opcional, normalizado pela mesma função de
cadastro/PATCH; resultados são contatos distintos com seus canais. Sem phone,
lista o diretório do tenant, inclusive inativos. Não há busca global.

## Pacientes e representantes — TASK-008

O catálogo atual tem 22 permissões: CLINIC_ADMIN 22, AGENT 15, DOCTOR 4.
Nova patient.authorize pertence somente a CLINIC_ADMIN; aplicar o seed RBAC explícito
após migration. Nenhum privilégio novo para SUPER_ADMIN/MANAGER reservados.

| Endpoint                                           | Permissões                                     |
| -------------------------------------------------- | ---------------------------------------------- |
| GET /patients e GET /patients/:id                  | patient.view                                   |
| POST /patients e PATCH /patients/:id               | patient.edit                                   |
| GET /patients/:patientId/relationships             | patient.view + contact.view                    |
| POST /patients/:patientId/relationships            | patient.edit + contact.view                    |
| PATCH /patients/:patientId/relationships/:id       | patient.edit + contact.view                    |
| POST /patients/:patientId/relationships/:id/revoke | patient.edit + contact.view                    |
| GET /contacts/:contactId/patient-links             | patient.view + contact.view                    |
| GET /contacts/:contactId/patients/:patientId       | patient.view + contact.view + vínculo elegível |

POST/PATCH de vínculos exigem adicionalmente patient.authorize ao receber VERIFIED,
FULL, SCHEDULING_ONLY ou legalRepresentative=true. A regra é aplicada novamente no
service/repository, não apenas no guard. Todas as operações usam o tenant ativo,
sem aceitar tenant arbitrário no corpo/header. FKs compostas impedem Patient,
Contact e autores de outros tenants. Detalhes de projeção/autorização contextual
estão em security.md; revogação e principal em domain-model.md.

## Catálogo de especialidades/serviços — TASK-009

Todas as rotas administrativas /specialties e /services exigem service.manage,
existente no catálogo e concedida a CLINIC_ADMIN. Não há nova permissão nem
concessão a AGENT/DOCTOR. Guards, services e repositories validam; filtros SQL
incluem tenant/sessão/vínculo/permissão. FK composta impede serviço e especialidade
de tenants diferentes. IDs externos/inexistentes retornam o mesmo 404 genérico;
conflito de nome/concorrência retorna 409 sem dados do registro conflitante.

GET listagem/detalhe, POST criação e PATCH alteração/active usam somente o tenant
da sessão. Listagens aceitam active=true/false; /services aceita também specialtyId.
Filtrar especialidade externa/inexistente retorna 404. Sem filtro, o catálogo
administrativo inclui inativos. Campos/queries desconhecidos são rejeitados.
Respostas expõem apenas ID e campos de negócio, sem tenantId/timestamps internos.

## Profissionais — TASK-010

| Endpoints                                                                            | Permissões                       |
| ------------------------------------------------------------------------------------ | -------------------------------- |
| GET/POST /providers e GET/PATCH /providers/:id                                       | provider.manage                  |
| GET/POST /providers/:providerId/services e PATCH /providers/:providerId/services/:id | provider.manage + service.manage |
| GET /services/:serviceId/providers                                                   | provider.manage + service.manage |
| GET/POST /providers/:providerId/units e PATCH /providers/:providerId/units/:id       | provider.manage + unit.view      |

Nenhuma nova permissão/concessão: CLINIC_ADMIN possui as políticas necessárias;
AGENT/DOCTOR não gerenciam profissionais. Verificações existem no guard, service,
repository e SQL, sempre com tenant/sessão/vínculo/permissões. FKs compostas
proíbem vínculos cruzados. ID externo/inexistente tem o mesmo 404; vínculo duplicado
ou conflito concorrente, 409 genérico. Responses omitem tenantId/timestamps internos.
A consulta de habilitados por serviço omite registro profissional e inclui apenas
cadastros/vínculos/serviço ativos. Essa consulta não calcula disponibilidade.

## Disponibilidade — TASK-011

GET/POST /availability-rules, GET/PATCH /availability-rules/:id,
GET/POST /schedule-exceptions, GET/PATCH /schedule-exceptions/:id e
GET /providers/:providerId/availability exigem provider.manage + unit.view.
Não há novas concessões de RBAC; o acesso atual é administrativo por CLINIC_ADMIN.
Services/repositories repetem autorização e consultas incluem filtros SQL de
sessão/tenant/permissões. Não há acesso público nem autorização pelo frontend.

Listas aceitam providerId, unitId e active; exceções também dateFrom/dateUntil
inclusivos. Filtros/IDs externos e inexistentes retornam o mesmo 404. Respostas
omitem tenantId/timestamps técnicos; a resposta estrutural expõe apenas date,
timezone e janelas. Associações com outro tenant são impedidas por FKs compostas.
A consulta estrutural não concede acesso a pacientes nem confirma disponibilidade
final para agendamento.

## TASK-032 — Contexto de plataforma

PlatformAdmin é concessão global independente de UserTenant. PlatformScope nasce
após sessão com TOTP confirmado. Repositories de clínica continuam exigindo tenant;
PlatformRepository é a única camada nova de consultas agregadas globais. Detalhe
recebe target tenant explícito, limita projeções e registra PLATFORM_TENANT_VIEWED
com ator real. Nenhum parâmetro do cliente remove filtros. A restrição histórica
de SUPER_ADMIN permanece para roles de membership; veja [super-admin.md](super-admin.md).

# Planos e assinatura

Cada Tenant tem uma TenantSubscription única. O ciclo e o consumo são
tenant-scoped; a política de limites e capacidades está em
[`plans-usage.md`](./plans-usage.md).
