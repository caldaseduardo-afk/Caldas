# Arquitetura Técnica

## 1. Estratégia

Usar monólito modular no MVP.

Não iniciar com microserviços.

## 2. Stack

### Frontend
- Next.js
- React
- TypeScript

### Backend
- NestJS
- TypeScript

### Banco
- PostgreSQL

### ORM
- Prisma

### Cache / locks
- Redis

### Jobs
- BullMQ

### Tempo real
- WebSocket

### Storage
- S3 compatível

### Monorepo
- pnpm
- Turborepo

### Infra
- Docker

## 3. Estrutura

```text
/apps
  /web
  /api
  /worker

/packages
  /database
  /domain
  /types
  /ui
  /config
```

## 4. Módulos do backend

```text
auth
tenants
units
users
permissions

contacts
patients
relationships

specialties
services
providers

availability
appointments
scheduling

conversations
messages
handoff

ai
integrations

notifications
automations

analytics
billing

audit
```

## 5. Fluxo WhatsApp

```text
WhatsApp
   ↓
Webhook
   ↓
Validação/idempotência
   ↓
Persistência
   ↓
Conversation Engine
   ↓
IA ou Humano
   ↓
Provider de envio
```

Persistir antes de processar.

## 6. Fluxo IA

```text
Mensagem
  ↓
Conversation Engine
  ↓
AI Agent
  ↓
Tool Gateway
  ↓
Policy/Authorization
  ↓
Domain Service
  ↓
Repository
  ↓
PostgreSQL
```

## 7. Tool Gateway

A IA nunca acessa repository diretamente.

Tools iniciais:

- get_contact_context
- get_patient_context
- list_specialties
- list_services
- search_available_slots
- create_appointment_hold
- confirm_appointment
- reschedule_appointment
- cancel_appointment
- get_appointment
- transfer_to_human

## 8. Calendar Provider

Interface conceitual:

```ts
interface CalendarProvider {
  getAvailableSlots(...): Promise<...>
  createEvent(...): Promise<...>
  updateEvent(...): Promise<...>
  cancelEvent(...): Promise<...>
}
```

Implementações futuras:

- GoogleCalendarProvider
- OutlookCalendarProvider
- InternalCalendarProvider

PostgreSQL continua sendo fonte principal de verdade.

## 9. Messaging Provider

Interface para canais.

Primeira implementação:

- WhatsApp Business

Futuro:

- Web chat
- Instagram
- outros canais

## 10. Filas

BullMQ para:

- confirmation
- reminder
- retry
- human_sla_alert
- calendar_sync
- whatsapp_delivery
- appointment_hold_cleanup
- waitlist_match

## 11. Redis

Usos:

- cache;
- locks;
- filas;
- estado temporário quando adequado.

Não usar Redis como fonte primária de dados de negócio.

## 12. WebSocket

Usar para atualizar a inbox em tempo real:

- nova mensagem;
- alteração de status;
- atribuição;
- digitação quando aplicável;
- mudança de consulta.

## 13. Falhas externas

A falha de um provider não deve apagar operação interna válida.

Exemplo:

1. consulta criada internamente;
2. sincronização com Google falha;
3. consulta permanece;
4. `sync_status = ERROR`;
5. job tenta novamente.

## 14. Observabilidade

Separar:

### Application logs
Diagnóstico técnico.

### Audit logs
Registro de ação de usuário/sistema.

Também prever:

- health checks;
- métricas;
- error tracking;
- fila de jobs;
- dashboards operacionais.

## 15. Deploy inicial

Containers separados:

- web;
- api;
- worker.

Serviços externos ou gerenciados recomendados para:

- PostgreSQL;
- Redis;
- storage.

## 16. Convenções

- IDs internos: UUID.
- Datas persistidas em UTC.
- Exibir datas no timezone da clínica.
- Nunca confiar no timezone do browser para regra crítica.
- Valores monetários: decimal, nunca float.
- Estados críticos: enums explícitos.
