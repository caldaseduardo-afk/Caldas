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
