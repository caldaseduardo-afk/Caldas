# Modelo de Domínio

## Entidades principais

```text
TENANT
 ├── UNIT
 ├── USER_TENANT
 ├── CONTACT
 │    └── CONTACT_CHANNEL
 ├── PATIENT
 │    └── CONTACT_PATIENT
 ├── SPECIALTY
 │    └── SERVICE
 ├── PROVIDER
 │    ├── PROVIDER_SERVICE
 │    └── AVAILABILITY_RULE
 ├── SCHEDULE_EXCEPTION
 ├── APPOINTMENT
 ├── APPOINTMENT_HOLD
 ├── WAITLIST
 ├── CONVERSATION
 │    └── MESSAGE
 ├── NOTIFICATION_RULE
 ├── INTEGRATION
 └── AUDIT_LOG
```

## TENANT

Campos mínimos:

- id
- name
- status
- timezone
- created_at
- updated_at

## UNIT

- id
- tenant_id
- name
- address
- timezone_override opcional
- active

## USER

- id
- email
- name
- password_hash
- mfa_enabled
- status
- created_at

## USER_TENANT

- user_id
- tenant_id
- role
- active

## USER_UNIT

- user_id
- unit_id

## CONTACT

Pessoa que entra em contato.

- id
- tenant_id
- display_name
- status
- created_at

## CONTACT_CHANNEL

- id
- tenant_id
- contact_id
- type
- address
- provider_external_id
- primary
- verified_at

`address` pode representar telefone, e-mail ou identificador futuro.

## PATIENT

- id
- tenant_id
- name
- birth_date
- document opcional
- health_plan opcional
- payment_preference opcional
- notes
- created_at
- updated_at

## CONTACT_PATIENT

- id
- tenant_id
- contact_id
- patient_id
- relationship_type
- relationship_status
- authorization_level
- is_primary_contact
- legal_representative
- active
- authorized_at
- authorized_by
- revoked_at
- revoked_by

## SPECIALTY

- id
- tenant_id
- name
- description
- active

## SERVICE

- id
- tenant_id
- specialty_id
- name
- description
- duration_minutes
- buffer_before_minutes
- buffer_after_minutes
- price
- active

## PROVIDER

- id
- tenant_id
- name
- professional_type
- registration_number
- active

## PROVIDER_SERVICE

- id
- tenant_id
- provider_id
- service_id
- duration_override_minutes
- price_override
- active

## AVAILABILITY_RULE

- id
- tenant_id
- provider_id
- unit_id
- weekday
- start_time
- end_time
- valid_from
- valid_until

## SCHEDULE_EXCEPTION

- id
- tenant_id
- provider_id
- unit_id
- date
- start_time
- end_time
- type
- reason

Tipos:

- BLOCK
- EXTRA_AVAILABILITY
- VACATION
- HOLIDAY
- MEETING
- OTHER

## APPOINTMENT_HOLD

- id
- tenant_id
- patient_id
- contact_id
- service_id
- provider_id
- unit_id
- conversation_id
- start_at
- end_at
- expires_at
- status

## APPOINTMENT

- id
- tenant_id
- unit_id
- patient_id
- contact_id
- provider_id
- service_id
- start_at
- end_at
- status
- source
- created_by_type
- created_by_id
- previous_appointment_id opcional
- calendar_provider
- external_event_id
- sync_status
- notes
- created_at
- updated_at

Status:

- PENDING_CONFIRMATION
- CONFIRMED
- CHECKED_IN
- COMPLETED
- CANCELLED
- NO_SHOW
- RESCHEDULED

Source:

- WHATSAPP_AI
- WHATSAPP_HUMAN
- WEB
- PHONE
- MANUAL
- IMPORT

## WAITLIST

- id
- tenant_id
- patient_id
- service_id
- provider_id opcional
- date_from
- date_to
- preferred_period
- priority
- status

## CONVERSATION

- id
- tenant_id
- contact_id
- active_patient_id
- channel
- status
- intent
- assigned_user_id
- handoff_reason
- last_message_at
- created_at
- updated_at

## MESSAGE

- id
- tenant_id
- conversation_id
- provider_message_id
- sender_type
- sender_user_id opcional
- message_type
- content
- metadata
- created_at
- delivered_at
- read_at

## NOTIFICATION_RULE

- id
- tenant_id
- type
- offset_minutes
- allowed_start_time
- allowed_end_time
- allowed_weekdays
- outside_window_policy
- retry_enabled
- retry_after_minutes
- max_attempts
- minimum_time_before_appointment
- action_if_no_response
- active

## INTEGRATION

- id
- tenant_id
- provider
- type
- status
- credentials_reference
- settings
- created_at
- updated_at

Nunca salvar segredo bruto quando puder usar secret manager.

## AUDIT_LOG

- id
- tenant_id
- actor_type
- actor_id
- action
- resource_type
- resource_id
- old_value
- new_value
- ip_address
- created_at

Audit logs devem ser append-only na aplicação.

## Base de persistência — TASK-002

A migration inicial materializa somente `Tenant` e `Unit`, sem CRUD ou regras de
acesso. As demais entidades serão adicionadas nas tarefas correspondentes.

- Tabelas `tenants` e `units`; propriedades Prisma em camelCase mapeadas para snake_case.
- IDs e `tenant_id`: UUID nativo, IDs gerados por `gen_random_uuid()` no PostgreSQL.
- Ambas possuem `created_at` e `updated_at` em `timestamptz(3)`; o Prisma mantém
  `updated_at` nas alterações. SQL administrativo deve atualizar esse campo explicitamente.
- `units.tenant_id` é obrigatório e referencia `tenants.id`, com RESTRICT em
  exclusão/alteração da chave. Unique `(tenant_id, id)` permite consulta composta e
  futuras FKs compostas entre recursos do mesmo tenant.
- `Tenant.status` permanece texto obrigatório sem default; estados e transições
  ainda não estão definidos. `ACTIVE` no seed é apenas um rótulo demonstrativo.
- `Unit.address` é texto obrigatório nesta base; não foi criado um modelo de endereço.
- `Tenant.timezone` é obrigatório; `Unit.timezone_override` é opcional.

Essas constraints garantem integridade referencial, não autorização. Sessão,
services/repositories com tenant obrigatório e testes de acesso entre tenants
serão implementados na TASK-004 antes de expor operações de negócio.

## Identidade e sessão — TASK-003

`User` é global, sem tenant_id; relacionamentos UserTenant continuam na TASK-004.
Email é único, normalizado com trim/lowercase e protegido por CHECK no PostgreSQL.
Status mínimo: ACTIVE/DISABLED. Password_hash contém scrypt; mfa_enabled e
mfa_required começam falsos. Created_at/updated_at seguem timestamptz(3).

`AuthSession` guarda user_id, token_hash SHA-256 único, created_at e expires_at.
`AuthEvent` registra USER_CREATED, LOGIN_SUCCEEDED, LOGIN_FAILED, LOGIN_THROTTLED
ou LOGOUT, com user_id opcional, ip_hash opcional e created_at. É auditoria de
identidade global, distinta da futura auditoria de operações por tenant.
`AuthThrottle` mantém chave HMAC, contador e expiração da janela de login.

Nenhuma dessas tabelas autoriza consulta a Tenant, Unit ou recursos de pacientes.

## Vínculo e tenant da sessão — TASK-004

UserTenant contém user_id/tenant_id como PK composta, role (texto obrigatório),
active (true por padrão) e created_at/updated_at. Vínculo não confere permissões
por papel nesta etapa. Tenant.status ACTIVE é o único estado aceito para contexto;
valores diferentes bloqueiam acesso sem definir novas transições funcionais.

AuthSession.active_tenant_id é opcional e inicia nulo. FK composta de
(user_id, active_tenant_id) para UserTenant impede vincular a sessão à associação
de outro usuário. Exclusão do vínculo elimina as sessões selecionadas nele.
AuthEvent recebe tenant_id opcional e eventos TENANT_SELECTED e
TENANT_MEMBERSHIP_GRANTED; ambos identificam o usuário e o tenant envolvidos.
Na concessão local, user_id identifica o beneficiário; o comando é restrito ao
ambiente de desenvolvimento e não identifica um operador autenticado. Na seleção
via API, user_id identifica o próprio usuário autenticado.

## Catálogo de autorização — TASK-005

Role (name como PK e enabled), Permission (name como PK) e RolePermission
(PK composta role_name/permission_name) materializam o catálogo global de política.
UserTenant.role mantém seu valor textual e ganha FK para Role.name; o papel só
vale no tenant daquele vínculo. A migration preserva papéis legados desabilitados
antes de adicionar a FK. Seed RBAC habilita apenas perfis operacionais conhecidos
e reconcilia suas associações conforme a matriz de docs/tenancy.md.

SUPER_ADMIN e MANAGER permanecem reservados, sem autorização. Sem cadastro de
papéis personalizados, permissões individuais ou gestão de papéis via HTTP.

## Operações de clínicas/unidades — TASK-006

Tenant.status na API aceita ACTIVE/INACTIVE; persistência continua texto para não
converter estados legados silenciosamente. Unit.active mantém o estado booleano
existente; não há segunda coluna status. Unit.timezoneOverride null herda timezone
do Tenant. A API valida nome/endereço/timezone; tenant_id nunca é editável.
DELETE aplica inativação, preservando dados e vínculos.

AuthEvent recebe resource_id UUID opcional e changes JSONB opcional. Eventos
TENANT_CREATED/UPDATED/DEACTIVATED e UNIT_CREATED/UPDATED/DEACTIVATED registram o
ator, tenant, recurso, horário e valores de configuração antes/depois. Operação e
evento são atômicos. No provisionamento local, user_id é o beneficiário do vínculo,
e changes.source identifica development-provisioning; não representa autenticação
do operador local. Auditoria completa de outras entidades permanece na TASK-030.

## Contatos e canais — TASK-007

Contact contém id/tenant_id, display_name, status ACTIVE/INACTIVE e timestamps.
ContactChannel contém id/tenant_id/contact_id, type PHONE/WHATSAPP, address canônico,
provider_external_id opcional, primary, verified_at opcional e timestamps. A API
não permite definir verified_at; número cadastrado não significa identidade
verificada. Alterar address limpa verified_at e o ID externo antigo, a menos que
um novo ID externo seja explicitamente informado.

FK composta (tenant_id, contact_id) referencia Contact(tenant_id, id); nenhuma
associação entre tenants é permitida. Uniques de canal: (tenant_id,type,address) e
(tenant_id,type,provider_external_id), permitindo múltiplos IDs externos nulos.
Índice parcial único em (tenant_id,contact_id) WHERE primary=true limita o principal.
CHECK exige address no formato + seguido de 8–15 dígitos (primeiro não zero).
Índices (tenant_id,address) e (tenant_id,contact_id) suportam busca e canais.

A aplicação mantém exatamente um principal quando há canais; o primeiro é
principal por padrão e promover outro troca ambos na mesma transação. Contato sem
canais é permitido. Não há remoção de canais nem fusão automática de contatos.
PHONE e WHATSAPP são tipos distintos, mesmo com o mesmo address. Buscar telefone
pode retornar mais de um contato se os tipos pertencerem a contatos distintos;
o backend não infere que são a mesma pessoa. Inativação não libera canais únicos.

AuthEvent recebe CONTACT_CREATED/UPDATED e CONTACT_CHANNEL_CREATED/UPDATED. O
registro contém ator, tenant, recurso e campos alterados, sem duplicar nome,
telefone ou identificador externo na auditoria. Pacientes e representantes são
implementados separadamente na TASK-008, descrita abaixo.

## Pacientes e representantes — TASK-008

Patient e Contact são entidades distintas. O Patient tem nome e nascimento
obrigatórios; nascimento usa DATE (YYYY-MM-DD válido, não futuro), sem hora.
Documento, convênio, preferência de pagamento e notas são opcionais. Não existe
unicidade global de documento nem inferência de identidade por nome/telefone.
ContactPatient representa N:N; SELF vincula o contato ao seu próprio Patient sem
criar outro Contact. Todas as relações e autores pertencem ao mesmo tenant.

RelationshipType: SELF, MOTHER, FATHER, SON_DAUGHTER, SPOUSE, LEGAL_GUARDIAN,
CAREGIVER, SECRETARY, OTHER. RelationshipStatus: DECLARED, VERIFIED, REVOKED.
PatientAuthorizationLevel: FULL, SCHEDULING_ONLY, NO_ACCESS. Estado e nível são
independentes; DECLARED/SCHEDULING_ONLY é válido, sem liberar leitura protegida.
Defaults: DECLARED/NO_ACCESS, active=true, principal/legal=false. Nenhum tipo de
parentesco, indicação de principal ou representante legal concede acesso sozinho.

Um vínculo é único por (tenant_id,contact_id,patient_id), inclusive após revogação.
Revogação é terminal nesta etapa e preserva a linha, autor e horário. Não há DELETE
nem reativação; nova autorização após revogação depende de política futura explícita.
Mudar relationship_type volta a DECLARED/NO_ACCESS/legal=false, salvo decisões
explícitas autorizadas na mesma requisição. authorized_by/at registram o último
ator da decisão de política, não uma prova automática de consentimento. A auditoria
preserva as decisões anteriores. revoked_by/at são definidos no servidor.

FKs compostas ligam ContactPatient a Contact e Patient e seus autores a UserTenant.
Índices (tenant_id,patient_id,active) e (tenant_id,contact_id,active) suportam consulta.
Patient tem unique (tenant_id,id). Índice parcial unique (tenant_id,patient_id)
WHERE active AND is_primary_contact limita o principal a um. Principal é opcional;
promover outro troca ambos atomicamente; revogar o principal deixa nenhum.
CHECKs exigem autoria/data em pares, decisão registrada para concessões e revogação
coerente (REVOKED, inactive, NO_ACCESS, não principal, autor/data obrigatórios).

AuthEvent adiciona PATIENT_CREATED/UPDATED e CONTACT_PATIENT_CREATED/UPDATED/REVOKED.
Operações e auditoria são atômicas, com ator/tenant/recurso. Pacientes registram só
nomes dos campos alterados; vínculos registram política antes/depois e IDs, sem
replicar dados pessoais/clínicos. Serviços de acesso contextual preparam a validação
de active_patient_id futuro; não existe Conversation nem seleção persistida nesta tarefa.

## Especialidades e serviços — TASK-009

Specialty é a área de atendimento; Service é o atendimento concreto que poderá
ser agendado futuramente. Ambos têm UUID, tenant obrigatório, nome, descrição
opcional, active e timestamps. Service exige Specialty do mesmo tenant pela FK
composta (tenant_id,specialty_id). Não existe relação com agenda ou profissionais
nesta entrega.

Duração é inteira positiva; buffers são inteiros não negativos com default zero.
Preço opcional usa Decimal(12,2), nunca float. A API recebe string decimal com ponto,
no máximo duas casas e dez dígitos inteiros, ou null. Retorna duas casas como string;
não aceita JSON number, expoente, negativo, excesso de casas ou arredondamento
implícito. Não há moeda/conversão nesta tarefa. CHECKs no PostgreSQL protegem
valores não negativos, duração positiva e rejeitam preço NaN.

Nomes são aparados nas bordas, com comparação exata sensível a caixa/acentos:
unique (tenant_id,name) em Specialty e (tenant_id,specialty_id,name) em Service.
Não há unicidade global. Inativação mantém o registro e reserva seu nome. PATCH
active=false/true permite inativar/ativar, sem exclusão física. Inativar Specialty
não modifica os serviços implicitamente; o catálogo administrativo permite
configurar serviços sob área inativa. Isso não significa disponibilidade de agenda;
a política de disponibilidade será implementada na tarefa correspondente.

Índices (tenant_id,active) em ambas as entidades e (tenant_id,specialty_id,active)
em Service atendem filtros básicos. AuthEvent adiciona SPECIALTY_CREATED/UPDATED
e SERVICE_CREATED/UPDATED. Escritas usam transação Serializable com auditoria
atômica, incluindo ator, tenant, recurso, campos alterados, active e mudança de
especialidade quando aplicável. Falha de auditoria reverte a escrita.

## Profissionais — TASK-010

Provider é um cadastro profissional, separado de User e Specialty. Possui UUID,
tenant obrigatório, name, professional_type textual extensível, registration_number
textual opcional/nulável, active e timestamps. Registro não é exclusivamente numérico
nem valida licença de conselho. Não há unicidade por nome/registro, pois não existe
regra de identidade/conselho definida; não se fundem profissionais por inferência.

ProviderService liga N:N Provider a Service, nunca diretamente a Specialty. Contém
UUID, tenant, provider/service, active, timestamps e overrides opcionais:
duration_override_minutes inteiro positivo e price_override Decimal(12,2) não
negativo. Null permanece null no banco; significa utilizar futuramente o default
atual do Service. Não há cópia de defaults, fallback persistido ou cálculo de agenda.
Preço zero é override válido. API recebe/retorna strings decimais, compartilhando
o parser monetário da TASK-009, sem float ou arredondamento implícito.

ProviderUnit é a associação N:N mínima com UUID, tenant, provider/unit, active e
timestamps. Um profissional pode atender em várias unidades sem duplicação.
FKs compostas impõem tenant comum em ambas as associações, com exclusão Restrict.
Unicidade (tenant_id,provider_id,service_id) e (tenant_id,provider_id,unit_id) vale
inclusive para inativos. Service e Provider têm unique (tenant_id,id); Unit já o tinha.
Índices por tenant/provider/active, tenant/service/active e tenant/unit/active
suportam listas. Provider possui índice (tenant_id,active). CHECKs protegem duração
positiva e preço válido (inclusive rejeição de NaN) nos overrides.

PATCH active=false/true preserva registros e permite reativação. Não há DELETE.
Os IDs relacionados são imutáveis no vínculo; pode-se inativar um e criar outro.
Inativar Provider não apaga nem altera vínculos em cascata. Listas administrativas
incluem inativos, salvo filtro active; é permitido configurar vínculos com entidades
inativas. A consulta de profissionais por Service retorna somente Provider ativo,
ProviderService ativo e Service ativo. É habilitação cadastral, não disponibilidade
em unidade/horário nem prova de licença. Unidade e regras de agenda serão contexto
futuro; Specialty permanece agrupamento acessado via Service.

AuthEvent recebe PROVIDER_CREATED/UPDATED, PROVIDER_SERVICE_CREATED/UPDATED e
PROVIDER_UNIT_CREATED/UPDATED. Escritas e auditoria são atômicas em transação
Serializable, com ator, tenant, recurso, IDs relacionados, campos alterados e active.
Não são copiados nomes, registros profissionais ou preços para os eventos.

## Disponibilidade — TASK-011

AvailabilityRule e ScheduleException são entidades relacionais com UUID, tenant,
provider/unit, active e timestamps. Ambas possuem FKs compostas para Provider,
Unit e o vínculo ProviderUnit existente, com delete/update Restrict. ProviderUnit
não pode ser removido fisicamente enquanto houver essas configurações.

AvailabilityRule usa Weekday (MONDAY..SUNDAY), TIME(0) para início/fim locais e DATE
para validFrom/validUntil. ScheduleException usa DATE e horários TIME(0) opcionais,
ScheduleExceptionType (BLOCK, EXTRA_AVAILABILITY, VACATION, HOLIDAY, MEETING, OTHER)
e reason opcional. Detalhes de timezone, precedência e intervalos em scheduling.md.

CHECKs validam ordem/precisão dos horários, validade e pares de horários. EXCLUDE
GiST com btree_gist proíbe interseção de regras ativas por tenant/provider/unit/
weekday, horário [start,end) e daterange inclusivo. Índices adicionais cobrem
provider/unit/weekday/active, validade, unit/active e, nas exceções, provider/unit/
date/active, tenant/date/type/active e tenant/unit/date.

Atualizações mantêm providerId/unitId imutáveis, revalidam o estado final e não
excluem registros. Escritas Serializable atualizam ProviderUnit para serializar
alterações do par; conflitos retornam 409 genérico. AuthEvent ganha
AVAILABILITY_RULE_CREATED/UPDATED e SCHEDULE_EXCEPTION_CREATED/UPDATED, persistidos
na mesma transação com ator/tenant/recurso/campos/active, sem copiar reason.

### Persistência de AppointmentHold (TASK-012)

Além dos identificadores de domínio e timestamps, o modelo usa requestId/creatorId
para idempotência por tenant/usuário e occupiedStartAt/occupiedEndAt como snapshot
da ocupação com buffers. FKs compostas incluem tenant e validam Patient, Contact
opcional, Service, Provider, Unit, ProviderService, ProviderUnit e UserTenant criador.
AppointmentHoldStatus: ACTIVE, EXPIRED, RELEASED, CONSUMED (uso futuro). Não há
Conversation implementada; sua relação será adicionada com FK na tarefa própria.
AuthEvent registra HOLD_CREATED, HOLD_RELEASED e HOLD_EXPIRED sem dados clínicos.

## Appointment persistido — TASK-013

Appointment possui os campos do modelo conceitual, holdId opcional (uma conversão
por HOLD), occupiedStartAt/occupiedEndAt com buffers em snapshot, cancelledAt e
cancellationReason. Autoria humana usa createdByType USER e createdById via FK
UserTenant; não aceitar identidade do payload. Outros tipos AI/SYSTEM/IMPORT ficam
reservados estruturalmente e não inventam usuário.

AppointmentSource contém WHATSAPP_AI/WHATSAPP_HUMAN/WEB/PHONE/MANUAL/IMPORT; a API
humana aceita WEB/PHONE/MANUAL. CalendarSyncStatus contém NOT_REQUIRED/PENDING/
SYNCED/ERROR; calendário só recebe valores quando houver integração futura. FKs
compostas impedem relações cross-tenant, incluindo predecessor e HOLD. Predecessor
pertence ao mesmo paciente, com no máximo um sucessor. Estados em scheduling.md.
AuthEventType recebe APPOINTMENT_CREATED/CONFIRMED/CANCELLED/RESCHEDULED/CHECKED_IN/
COMPLETED/NO_SHOW. Auditoria é inserida atomicamente com a operação.

## NotificationRule persistida — TASK-014

NotificationRule tem UUID, FK tenant, campos conceituais e timestamps UTC. Horários
allowedStartTime/allowedEndTime são TIME(0) locais, sem data/zona; o Date ancorado
em UTC usado pelo Prisma apenas transporta TIME, não converte horário da janela.
allowedWeekdays é Weekday[] PostgreSQL obrigatório, sem JSON; API normaliza dias
repetidos na ordem semanal. Não há unicidade por tenant/type.

Enums NotificationType (CONFIRMATION/REMINDER), OutsideWindowPolicy (PREVIOUS_ALLOWED_TIME/
NEXT_ALLOWED_TIME/SKIP), NoResponseAction (NONE/MARK_UNCONFIRMED/NEEDS_HUMAN/
CANCEL_APPOINTMENT). Defaults: retryEnabled false, retryAfterMinutes null, maxAttempts 1,
minimumTimeBeforeAppointment 0, actionIfNoResponse NONE, active true. Configurar retry
ativo exige retryAfterMinutes positivo; maxAttempts conta a inicial.

CHECKs protegem janela/precisão, array não vazio e sem null, números e retry. Índices
(tenant,type,active) e (tenant,createdAt), unique (tenant,id), FK tenant Restrict.
AuthEvent ganha NOTIFICATION_RULE_CREATED/UPDATED; escrita e auditoria são atômicas.
PATCH valida estado final e active=false preserva regra. Sem exclusão física ou
entidade de tentativa/disparo nesta task.

## Conversation/Message persistidas — TASK-015

Models separados com tenant obrigatório e FKs compostas. Conversation vincula Contact,
Patient ativo opcional, respectivo ContactPatient e responsável UserTenant opcional.
Message vincula Conversation incluindo channel e autor UserTenant opcional. Channel
em Message é dimensão da chave externa e tem integridade pela FK, não inferência do
cliente. Todas as exclusões são Restrict; não há DELETE pela API.

Enums ConversationChannel (WHATSAPP nesta etapa), ConversationStatus, ConversationIntent,
HandoffReason, MessageSenderType e MessageType conforme listas conceituais. AuthEvent
recebe CONVERSATION_CREATED/UPDATED/STATUS_CHANGED, MESSAGE_CREATED/RECEIPT_UPDATED.
Estados/limites estão em conversations.md. Sem nota interna USER completa nem resumo.

Unique parcial impede duas abertas por contato/canal/tenant; unique externo em Message
é tenant/channel/providerMessageId. CHECKs validam autoria USER, atribuição humana,
motivo NEEDS_HUMAN, conteúdo/metadata e ordem dos recibos. Índices de conversa cobrem
contato/paciente/responsável/intenção/status/canal/última mensagem/criação dentro do
tenant; Message tem tenant/conversation/createdAt/id e tenant/senderType/createdAt.
Trigger AFTER INSERT mantém lastMessageAt sem regredir. Dados de configuração e conteúdo
não são usados como mecanismo de deduplicação.

## Handoff — TASK-018

Conversation ganha handoffRequestedAt, assignedAt e resolvedAt, mapeados para
snake_case e timestamptz(3), geridos pelo relógio PostgreSQL. RequestedAt guarda
entrada do ciclo humano; assignedAt a atribuição atual; resolvedAt a resolução.
CHECK novo exige data para NEEDS_HUMAN, assignedAt somente em HUMAN_ACTIVE e
resolvedAt somente em RESOLVED/CLOSED. Constraints anteriores de responsável e
motivo e FK composta UserTenant são preservadas. Índice de fila:
(tenant_id,status,handoff_requested_at,id). Índices anteriores cobrem responsável
e última mensagem; não duplicar índices isolados sem necessidade.

Backfill usa último audit de transição correspondente ou updatedAt como aproximação
para registros legados; não representa reconstrução exata de datas ausentes.
AuthEvent recebe HUMAN_HANDOFF_REQUESTED, CONVERSATION_CLAIMED,
CONVERSATION_TRANSFERRED, CONVERSATION_RETURNED_TO_AI e CONVERSATION_RESOLVED.
Auditoria atômica guarda histórico sem copiar mensagens/paciente/telefone.

## SLA humano — TASK-019

HumanSlaRule: UUID, tenant único obrigatório, first/second/externalAlertMinutes,
internal/externalAlertEnabled, active, createdAt/updatedAt. HumanSlaCycle: UUID,
tenant/conversation/rule, requestedAt/endedAt/claimedAt, snapshot tipado dos mesmos
tempos/flags e createdAt. HumanSlaJob: UUID, tenant/cycle, level, dueAt,
nextDispatchAt, processedAt e createdAt. Todas as datas usam timestamptz(3).
Conversation ganha slaLevel, enum HumanSlaLevel NONE/FIRST/SECOND/EXTERNAL.

FKs compostas preservam tenant de Conversation/regra/ciclo/job. Unique parcial
limita ciclo aberto por tenant/conversation; unique tenant/cycle/level impede jobs
duplicados. Índice processedAt/nextDispatchAt/id atende dispatcher; índice
tenant/conversation/endedAt atende invalidação. Índices existentes de fila/responsável
permanecem suficientes; não há filtro por nível que justifique índice adicional.
CHECKs validam ordem/limites dos tempos, datas do ciclo e proíbem nível ativo fora
NEEDS_HUMAN. Nenhuma migration histórica foi alterada; nenhum backfill cria alertas.

AuthEvent adiciona HUMAN_SLA_RULE_CREATED/UPDATED, HUMAN_SLA_FIRST_ALERT,
HUMAN_SLA_SECOND_ALERT, HUMAN_SLA_EXTERNAL_ALERT_REQUIRED e HUMAN_SLA_CLEARED.
Registro operacional dos níveis fica no audit existente, não numa segunda tabela
idêntica. Jobs guardam somente execução/agendamento, sem texto de mensagem/paciente.

## Transporte WhatsApp — TASK-020

Integration materializa tenant/type/provider/status/credentialsReference/settings/timestamps
mais phoneNumberId e externalAccountId (WABA). Enums IntegrationType WHATSAPP,
IntegrationProvider WHATSAPP_CLOUD e IntegrationStatus ACTIVE/DEGRADED/ERROR/DISABLED.
Settings reservado null; token não pode ser salvo nele. UNIQUE provider/phoneNumberId
impede ambiguidade de roteamento; FK tenant e unique tenant/id sustentam relações compostas.

Conversation e Message recebem integrationId opcional com FK composta. Trigger exige
integração da Message exatamente igual à da Conversation, inclusive null, e outro impede
reatribuir integração de conversa histórica. Abertas únicas por tenant/contact/channel/
integration (e índice legado quando null). Message externa única por tenant/integration/
providerMessageId, mantendo unique tenant/channel/providerMessageId para registros legados.

Message adiciona requestId, deliveryStatus, recipientAddress, sendAttempts, nextAttemptAt,
sendingAt, sentAt e errorCode seguro. Enum MessageDeliveryStatus inclui LOCAL/RECEIVED/
PENDING/SENDING/SENT/DELIVERED/READ/FAILED. RequestId é único por tenant/senderUserId; intent
não depende do conteúdo para deduplicação. Destinatário é snapshot protegido de envio,
não exposto na projection da Inbox. Datas timestamptz(3), conteúdo/metadata existentes
preservados. Índice deliveryStatus/nextAttemptAt/id serve o dispatcher global; job revalida
tenant antes de operar. CHECKs protegem quantidade de tentativas, estados, autoria e IDs.

AuthEvent ganha INTEGRATION_CONFIGURED, MESSAGE_SEND_REQUESTED, MESSAGE_SEND_SUCCEEDED,
MESSAGE_SEND_FAILED. MESSAGE_CREATED/RECEIPT_UPDATED existentes são reutilizados. Banco
preserva intenção/audit independentemente da retenção Redis; não há tabela de payload
bruto, binários ou credenciais. Detalhes em integrations.md e plano TASK-020.

## AIUsage — TASK-021

Metadata de inferência por tenant: id UUID, tenant_id obrigatório (FK restritiva), provider,
model, status PENDING/SUCCESS/ERROR, tokens input/output/total nullable, estimated_cost
Decimal(20,10) nullable, latency_ms, attempts, error_code, correlation_id UUID,
provider_request_id opcional, created_at/completed_at UTC. Sem prompt, mensagem, resposta,
patient_id ou credenciais. Estado técnico não é estado de Conversation.

Índices (tenant_id,created_at), (tenant_id,correlation_id), (provider,model,created_at).
Correlation não é unique: chamadas repetidas podem consumir novamente. CHECKs garantem
contagens inteiras não negativas coerentes, null conjunto para usage desconhecido,
custo não negativo, até quatro tentativas e consistência do estado/conclusão/latência.
Custos não são estimados nesta fase; nenhuma tabela de preços embutida. Ver integrações
para autorização e conclusão de consumo após revogação de sessão.

## ToolExecution — TASK-022

Ledger de execução/auditoria com id UUID; tenant/conversation/contact/patient opcional;
actor_type AI/USER e actor_id do executor; para USER é o usuário real e para AI da
TASK-023 é o `AIProcessingRun.id`, sem criar usuário técnico fictício; correlation_id; tool_name/call_id;
input_hash SHA-256; status RUNNING/SUCCESS/ERROR; result JSON mínimo apenas para replay de
mutações; error_code; target_id; duration_ms; created_at/completed_at UTC.

FKs compostas de tenant com Conversation, Contact e Patient impedem referências externas.
ActorId é snapshot histórico do executor (não cria usuário para IA). Unicidade
(tenant_id,conversation_id,call_id); índices (tenant_id,created_at) e
(tenant_id,correlation_id). CHECKs validam ator, hash e estado/conclusão/duração.
Sem payload de argumentos nem conteúdo de conversas. Nenhuma exclusão física automática;
retenção/reconciliação operacional futura deve preservar histórico e não reabrir RUNNING.

## Conversation Engine — TASK-023

`AIProcessingRun` representa o processamento idempotente de uma mensagem PATIENT. Guarda
UUID, tenant/conversation, mensagem inbound, resposta opcional, correlationId, status
PENDING/PROCESSING/COMPLETED/FAILED/SKIPPED, tentativas, quantidade de tools, código de
erro seguro, datas e próximo despacho. Não armazena prompt, resposta do provider, tokens,
segredos ou payloads de tool. É único por tenant/mensagem inbound e a resposta só pode
pertencer ao mesmo tenant e à mesma conversa.

`ConversationEngineLease` guarda tenant/conversation, owner UUID, expiração e timestamps.
Há uma linha por conversa; o owner não é usuário. Índice por expiração permite recuperar
crash, e FK composta impede lease cross-tenant. Runs são indexados por estado/próximo
despacho e por tenant/conversa/estado/ordem.

Conversation recebe `aiSummary` opcional de até 2000 caracteres e
`aiSummaryUpdatedAt`. O resumo é contexto administrativo interno, não prontuário nem
fonte de verdade de consultas. Message recebe relações um-para-um opcionais com run
inbound/resposta; uniques e FKs de tenant/conversation/message impedem misturar conversas.

CHECKs limitam contadores e exigem `completedAt` somente nos estados terminais. AuthEvent
ganha CONVERSATION_ENGINE_STARTED/COMPLETED/FAILED/HANDOFF. A transação final cria a
Message AI, atualiza Conversation e conclui o run antes de liberar o lease.

## Base de Conhecimento (TASK-026)

`KnowledgeArticle` é a identidade editorial tenant-scoped, opcionalmente vinculada a uma `Unit`. `KnowledgeArticleVersion` contém o texto e o histórico. Artigos começam em `DRAFT`; uma versão publicada é imutável e uma edição posterior ocorre em nova versão draft. A publicação inativa a versão publicada anterior, preservando-a historicamente. `INACTIVE` remove o artigo do retrieval sem exclusão física.

Somente a combinação artigo `PUBLISHED` + versão `PUBLISHED`, dentro de `valid_from`/`valid_until`, é elegível para uso operacional. Há no máximo um draft e uma versão publicada por artigo. O conteúdo é administrativo; `CLINICAL_APPROVED` permite apenas reproduzir informação explicitamente aprovada e não autoriza diagnóstico, prescrição ou extrapolação.

## Configuração versionada da IA

- `AIConfiguration`: agregado único do tenant; mantém somente o ponteiro para a versão ativa.
- `AIConfigurationVersion`: snapshot editorial numerado com nome/tom/saudação, instruções administrativas, tópicos, capabilities, política de handoff e parâmetros controlados do modelo. Estados: `DRAFT`, `PUBLISHED`, `ARCHIVED`.
- Um tenant possui no máximo um draft e uma versão publicada ativa. Publicadas/arquivadas não são editadas. Restauração copia uma versão histórica para o próximo número e registra a origem em `basedOnVersionId`.
- `AIProcessingRun.aiConfigurationVersionId` e `AIUsage.aiConfigurationVersionId` registram a versão efetiva. Ambos podem ser nulos somente para o fallback seguro sem configuração publicada.

## AuditLog consolidado — TASK-030

A implementação reutiliza AuthEvent/auth_events: type corresponde à action e userId
a actor_user_id. actorType, actorReferenceId, source, resourceType, previousValues,
newValues, metadata e correlationId são campos estruturados. isBusiness diferencia
mutações relevantes de histórico técnico/identidade global legado. Eventos de negócio
exigem tenantId/resourceId/resourceType; não têm updatedAt nem exclusão em cascata.
Consulte [audit.md](audit.md) para matriz, compatibilidade e política append-only.
