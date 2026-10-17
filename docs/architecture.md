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

Na implementação Google da TASK-029, `CalendarProvider` não recebe Prisma nem
`tenant_id` vindo de payload externo. O worker resolve integração e consulta no
PostgreSQL, monta um comando mínimo e chama o provider. Um ledger por consulta e
revisão torna a fila reconstruível e impede que o resultado de uma revisão antiga
sobrescreva uma alteração mais nova.

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

## Tempo real da Inbox — TASK-017

WebSocket nativo com `ws`, integrado ao HTTP server do Nest por RealtimeGateway;
WebSocket nativo do navegador gerenciado por hook único no Workspace. Não há
Socket.IO, segundo mecanismo de autenticação ou serviço separado.

ConversationRepository coleta eventos internos dentro da transação e publica pelo
RealtimeEvents após commit. Gateway traduz avisos para conexões autorizadas.
Controllers não conhecem o transporte. AuthService e TenantRepository notificam
invalidação de sessão após mudanças confirmadas. CRUD permanece HTTP/REST.

Next encaminha upgrade `/realtime` à API por rewrite externo, preservando Cookie
e Origin. `API_INTERNAL_URL` é configuração do servidor; em build de produção deve
estar definido antes de `next build`, pois rewrites integram o artefato. É possível
alternativamente encaminhar esse path pelo reverse proxy público à API. A origem
externa deve usar HTTPS/WSS em produção e coincidir com AUTH_ORIGIN. Não usar hosting
que encerre conexões longas sem oferecer encaminhamento de upgrade.

Barramento e rooms são locais a uma instância. Escalar API horizontalmente exigirá
barramento/adapter compartilhado (por exemplo Redis), invalidações de sessão entre
instâncias e avaliação de outbox durável. Não implementar essa infraestrutura agora.

## Jobs de SLA humano — TASK-019

BullMQ/Redis são introduzidos na fila única human-sla. Código de transporte e
persistência fica na infraestrutura backend de packages/database, reutilizado
por API e worker; cálculo puro fica em packages/domain. Não há novo microserviço.
REDIS_URL configura conexão (redis/rediss), sem host fixo no código. Compose oferece
Redis persistente com appendonly/noeviction; credenciais/isolamento de rede devem
seguir o ambiente. Worker exige URL; API sem URL mantém REST e intenção no banco,
mas não recebe os eventos de conclusão do worker.

Transação de handoff grava ciclo e até três registros HumanSlaJob. Dispatcher do
worker lê até 100 jobs pendentes por índice a cada 5s, enfileirando pelo UUID do
registro e com delay até dueAt. Não varre todas as conversas. Falha após commit
não perde intenção. Após enqueue, a revisão ocorre em dueAt + 60s (ou agora + 60s
para atrasados): job ausente é recriado, failed é reexecutado, completed sem marca
no PostgreSQL é substituído. Duplicação de dispatch é segura por jobId/unique SQL.

BullMQ tenta cinco vezes com backoff exponencial de 1s. Outbox continua permitindo
recuperação operacional após esgotamento, com revisão espaçada; falhas geram log
estático seguro. Jobs completos no Redis retidos até 1 dia/10000, falhos até
7 dias/10000. PostgreSQL preserva ciclo/audit independentemente da retenção Redis.

Worker revalida tenant ativo, regra ativa, ciclo aberto, requestedAt e estado sob
o mesmo lock PostgreSQL de Conversation usado pelo claim. Transação Serializable
com retry evita elevação duplicada. Invalidação marca jobs processados no banco;
job Redis ainda existente deve retornar SKIP. Redis nunca decide ownership ou nível.

QueueEvents encaminha avisos mínimos de conclusão ao RealtimeEvents já existente.
Isso transporta eventos SLA entre worker/API; não transforma os demais eventos do
monólito em barramento distribuído. Não há garantia de entrega visual exatamente
uma vez: falha após commit/antes de retorno, retenção do stream ou API desligada
podem perder um aviso. REST/reconexão recupera estado; jobs/audit continuam duráveis.

Referências utilizadas: [identidade dos jobs](https://docs.bullmq.io/guide/jobs/job-ids),
[eventos](https://docs.bullmq.io/guide/events/) e
[conexões](https://docs.bullmq.io/guide/connections). BullMQ 6 utiliza o driver
opcional ioredis, incluído explicitamente nas dependências deste repositório.

## Transporte WhatsApp — TASK-020

MessagingProvider é contrato de domínio; WhatsAppProvider/adaptadores BullMQ ficam na
infraestrutura backend compartilhada de packages/database (mesmo padrão da TASK-019).
API messaging autentica webhook e normaliza payload; ConversationIngressService executa
a aplicação de conversas reutilizando getOrCreateConversation e normalização existente.
Sem dependência Meta no serviço público de conversas, sem microserviço novo.

Message funciona como outbox de envio em PostgreSQL; worker existente despacha fila única
whatsapp-delivery. Claim, tentativas e estado persistem no banco. Redis não decide tenant,
autorização ou idempotência. QueueEvents encaminha avisos mínimos ao barramento/gateway
existentes; não envia texto nem abre canal realtime paralelo. Webhook só faz persistência
limitada e eventos após commit; não chama serviços externos/IA antes de responder.

Recuperação de lease vencido marca falha incerta e publica aviso via conclusão do job.
Retry BullMQ de falha de infraestrutura não equivale a retry da chamada Meta: estado SQL
controla se uma nova chamada é permitida. Limites, configuração e riscos em integrations.md.

## AI Provider implementado — TASK-021

Contrato em `packages/domain`; adaptador SDK em `apps/api/src/ai/openai.provider.ts` sem
imports de banco ou negócio. `AIModule` exporta apenas `AIService` interno; autorização e
persistência de metadata pertencem ao service/repository, não ao provider. Não há controller
ou conexão automática com conversas/worker/WhatsApp. Configuração é global por ambiente,
com resolver central para evolução futura por tenant. Ver docs/integrations.md para limites,
retries, privacidade e semântica de AIUsage. TASK-022/023 permanecem fora desta entrega.

## Tool Gateway implementado — TASK-022

Módulo `tools` exporta serviço interno ToolGateway, sem controller. Registry/schemas Zod,
handlers com switch fechado, repositories separados de contexto/ledger. SchedulingService
usa repository e helpers de agenda existentes. Mutações chamam HoldsService,
AppointmentsService e ConversationsService, preservando suas transações/auditoria/eventos.
Boundary de operação interno revalida contexto/deadline dentro dessas transações; não
executa código do modelo. Catálogo ganha leitura de atendimento com appointment.view,
sem ampliar permissões de edição. AI delegada exige sessão real + capacidades explícitas.
Contrato é preparatório; AIProvider continua sem loop, banco ou despacho automático.

## Retrieval da Base de Conhecimento

A Base de Conhecimento permanece no monólito e no PostgreSQL. `KnowledgeRetriever` isola o Conversation Engine da implementação de busca. O MVP usa `tsvector` gerado com configuração `portuguese`, índice GIN e ranking `ts_rank_cd`, sempre com `tenant_id`, status e validade na própria query. O retorno é limitado a cinco resultados, 1.200 caracteres por resultado e 4.000 caracteres no total. Artigos do MVP não são divididos em chunks; o limite editorial é 8.000 caracteres e a abstração permite introduzir chunks ou outro índice no futuro.

## Configuração versionada da IA — TASK-027

`AIConfiguration` é única por tenant e aponta para uma `AIConfigurationVersion` publicada. Versões publicadas e arquivadas são históricas e imutáveis; edição ocorre em um único draft, com optimistic locking. Publicação e restauração atualizam o ponteiro ativo em transação Serializable. Restaurar cria uma nova versão publicada baseada na histórica.

O `AIPromptComposer` coloca primeiro as regras fixas da plataforma, depois a configuração administrativa do tenant identificada como autoridade inferior. Contexto de conhecimento e conversa continua sendo dado não confiável. Modelos vêm de allowlist do ambiente, credenciais nunca entram na configuração e as capabilities efetivas são a interseção entre catálogo fixo e versão publicada. O Conversation Engine e o `AIUsage` registram a versão usada em cada execução.

A simulação de draft usa o mesmo provider e o mesmo retriever publicado, mas não abre turno no Tool Gateway e nunca executa ferramenta mutável. Sem versão publicada, o engine usa fallback seguro em memória. Não há cache nesta etapa: cada run lê a versão ativa por índice, evitando invalidação inconsistente entre instâncias.

## Worker e automações — TASK-028

`apps/worker` hospeda os processors BullMQ do monólito modular. A fila
`appointment-notifications` transporta somente IDs, cycleKey, attemptNumber e
correlationId. Dados de paciente, telefone, conteúdo, token e regra não entram no
payload. Cada execução consulta o PostgreSQL novamente e valida tenant e estado atual.

O PostgreSQL contém `NotificationAttempt`, Message/outbox e os vínculos compostos por
tenant. Redis pode ser descartado e reconstruído pela reconciliação periódica. O job de
automação não chama o provider: ele registra a Message antes do efeito externo, e o
worker de entrega da TASK-020 executa a chamada. Essa separação mantém retries técnicos
da fila distintos de retries funcionais de confirmação.

Concorrência é configurada por `WORKER_CONCURRENCY`; o horizonte de reconstrução por
`NOTIFICATION_RECONCILIATION_HORIZON_DAYS`. Jobs completos e falhos têm retenção
limitada. Logs estruturados contêm somente identificadores operacionais, tipo, tentativa,
resultado e duração. O shutdown para os loops, aguarda workers/filas e depois encerra
banco e aplicação.

## Auditoria — TASK-030

O helper compartilhado packages/database/src/audit.ts recebe explicitamente o
transaction client da ação de domínio. Não há microserviço, event sourcing ou
interceptor HTTP que gere eventos de negócio automaticamente. O interceptor fornece
apenas contexto confiável da execução; tools e worker definem seus próprios atores.
AuthEvent é o modelo físico compatível de AuditLog, preservando auth_events.
A API /audit e tela /settings/audit são somente leitura e tenant-scoped.
Detalhes e matriz em [audit.md](audit.md).

## Dashboard operacional — TASK-031

Módulo analytics agrega dados transacionais no PostgreSQL com SQL parametrizado,
contexto/RBAC e snapshot RepeatableRead por tenant. O frontend consome DTOs de
packages/types, sem receber entidades/pacientes nem calcular métricas. Sem serviço,
cache ou pipeline BI novo. Fórmulas, filtros e limites em [dashboard.md](dashboard.md).
