# Backlog Técnico

## Regra

Executar em ordem, salvo dependência explicitamente alterada.

Cada tarefa deve possuir testes e critérios de aceite.

---

## TASK-001 — Inicializar monorepo

### Objetivo

Criar estrutura inicial.

### Entrega

- pnpm workspace;
- Turborepo;
- `apps/web`;
- `apps/api`;
- `apps/worker`;
- `packages/database`;
- `packages/domain`;
- `packages/types`;
- `packages/ui`;
- `packages/config`;
- lint;
- formatter;
- typecheck;
- testes básicos;
- Docker local.

### Aceite

`pnpm install`, lint, typecheck e testes devem executar com sucesso.

---

## TASK-002 — PostgreSQL + Prisma

### Objetivo

Configurar banco e migrations.

### Entrega

- Prisma;
- PostgreSQL;
- UUID;
- timestamps;
- padrão de `tenant_id`;
- migration inicial;
- seed mínimo de desenvolvimento.

### Aceite

Banco sobe localmente e migrations funcionam do zero.

---

## TASK-003 — Autenticação

### Entrega

- usuário;
- senha com hash seguro;
- login;
- logout;
- sessão;
- proteção básica;
- base para MFA.

### Aceite

Rotas privadas bloqueadas sem sessão.

---

## TASK-004 — Multi-tenancy

### Entrega

- Tenant;
- UserTenant;
- tenant ativo;
- middleware/context;
- isolamento em services/repositories.

### Aceite

Teste prova que Tenant A não acessa Tenant B.

---

## TASK-005 — RBAC

### Entrega

- roles;
- permissions;
- guards;
- seed de permissões.

### Aceite

Permissões críticas cobertas por testes.

---

## TASK-006 — Clínicas e unidades

### Entrega

CRUD de tenant/unidades dentro das permissões definidas.

---

## TASK-007 — Contatos e canais

### Entrega

- Contact;
- ContactChannel;
- busca por telefone;
- normalização.

---

## TASK-008 — Pacientes e representantes

### Entrega

- Patient;
- ContactPatient;
- vínculos;
- autorização;
- paciente ativo.

### Aceite

Contato sem autorização não acessa dados de paciente.

---

## TASK-009 — Especialidades e serviços

### Entrega

- Specialty;
- Service;
- duração;
- buffers;
- preço opcional.

---

## TASK-010 — Profissionais

### Entrega

- Provider;
- ProviderService;
- vínculo com unidades.

---

## TASK-011 — Disponibilidade

### Entrega

- AvailabilityRule;
- ScheduleException;
- serviço para cálculo de disponibilidade.

---

## TASK-012 — HOLD

### Entrega

- AppointmentHold;
- expiração;
- prevenção de concorrência.

### Aceite

Dois HOLDs não ocupam o mesmo recurso/slot.

---

## TASK-013 — Consultas

### Entrega

- Appointment;
- estados;
- criação;
- cancelamento;
- remarcação;
- auditoria.

---

## TASK-014 — Notification Rules

### Entrega

- confirmação;
- lembrete;
- janela;
- dias;
- outside-window policy;
- retry.

### Aceite

Teste do cenário consulta 08:00 + offset 4h + janela 08–20.

---

## TASK-015 — Conversas

### Entrega

- Conversation;
- Message;
- estados;
- intents;
- persistência.

---

## TASK-016 — Inbox Web

### Entrega

- lista;
- busca;
- filtros;
- chat;
- painel lateral;
- responsividade desktop.

---

## TASK-017 — WebSocket

### Entrega

Atualização em tempo real das conversas.

---

## TASK-018 — Handoff humano

### Entrega

- assumir;
- lock;
- transferir;
- devolver para IA;
- fila NEEDS_HUMAN.

---

## TASK-019 — SLA humano

### Entrega

- regras;
- jobs;
- alertas;
- contador de espera.

---

## TASK-020 — WhatsApp Provider

### Entrega

- provider;
- webhook;
- validação;
- idempotência;
- envio;
- status.

---

## TASK-021 — AI Provider

### Entrega

- interface;
- implementação OpenAI;
- configuração;
- logging seguro;
- controle de custo.

---

## TASK-022 — Tool Gateway

### Entrega

Tools autorizadas e schemas.

### Aceite

Nenhuma tool acessa dados sem tenant e autorização.

---

## TASK-023 — Conversation Engine

### Entrega

- roteamento;
- intenção;
- IA/humano;
- resumo;
- handoff.

---

## TASK-024 — Agendamento via IA

### Entrega

- identificar serviço;
- buscar slots;
- HOLD;
- confirmação;
- criação.

---

## TASK-025 — Cancelamento/remarcação via IA

### Entrega

Respeitar regras de clínica e autorização.

---

## TASK-026 — Base de conhecimento

### Entrega

Conteúdo por tenant e retrieval controlado.

---

## TASK-027 — Configuração/versionamento da IA

### Entrega

- configuração;
- versões;
- publicar;
- restaurar;
- modo teste.

---

## TASK-028 — Worker e automações

### Entrega

- BullMQ;
- confirmação;
- lembrete;
- retry;
- cleanup.

---

## TASK-029 — Google Calendar Provider

### Entrega

- provider;
- criação;
- alteração;
- cancelamento;
- sync status;
- retry.

---

## TASK-030 — Auditoria completa

### Entrega

Audit log para operações críticas.

---

## TASK-031 — Dashboard clínica

### Entrega

KPIs operacionais.

---

## TASK-032 — Super Admin

### Entrega

- clínicas;
- status;
- consumo;
- usuários;
- saúde de integrações.

---

## TASK-033 — Planos e consumo

### Entrega

Estrutura básica de planos, limites e alertas.

---

## TASK-034 — Hardening

### Entrega

- rate limiting;
- headers;
- testes de autorização;
- revisão de logs;
- backup/restore;
- health checks.

---

## TASK-035 — MVP Release Candidate

### Aceite

Fluxo completo:

WhatsApp → IA → disponibilidade → HOLD → agendamento → confirmação → humano → auditoria.
