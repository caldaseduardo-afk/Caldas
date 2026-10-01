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
