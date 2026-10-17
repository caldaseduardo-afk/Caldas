# TASK-022 — Tool Gateway

## Objetivo e escopo

Registry interno de dez tools estreitas, schemas únicos de entrada/saída, contexto
confiável, autorização por conversa/contato/paciente, integração com services existentes,
auditoria/idempotência duráveis, limites e testes. Sem endpoint, loop LLM ou TASK-023.

## Decisões e divergências identificadas antes da implementação

- Services existentes operam com sessão humana real. Manter essa fronteira: ator AI é
  delegado por sessão autenticada e tem a interseção de capacidades explícitas com RBAC
  do usuário responsável; nunca criar usuário fictício, SUPER_ADMIN ou bypass. Auditoria
  do gateway registra AI e usuário executor; auditoria de domínio preserva executor real.
  Autonomia sem sessão/canal autenticado pertence à integração futura, não será inventada.
- Contexto opaco emitido por beginTurn, vinculado à instância/request, sessão, conversation,
  contact e activePatient derivados do banco. Arguments rejeitam campos extras. IA só
  opera AI_ACTIVE; USER em AI_ACTIVE ou HUMAN_ACTIVE (neste último exige ownership).
- ContactPatient precisa ser ativo VERIFIED e FULL/SCHEDULING_ONLY para agendamento.
  Contexto mínimo lista apenas vínculos autorizados, sem datas de nascimento/documentos.
  Paciente das operações vem da Conversation, nunca de argumento arbitrário.
- Catálogo atual exige service.manage. Adicionar leitura estreita de catálogo para
  atendimento com appointment.view, sem conceder edição de serviços à IA/AGENT.
- Não existe busca final de slots: adicionar SchedulingService/Repository que reutiliza
  disponibilidade estrutural e helpers de duração/buffer/conflitos. Datas ISO UTC explícitas,
  intervalo até 7 dias, até 20 resultados, até 20 combinações provider/unit, passos de 15min;
  backend valida timezone local e exceções. Busca é informativa; HOLD revalida sob lock.
- Revalidar contexto dentro das transações existentes de HOLD/Appointment/handoff via
  boundary interno AsyncLocalStorage, incluindo deadline e vínculo/paciente/conversa.
  Não recriar transações de domínio no gateway. Callback interno não é ferramenta da IA.
- Confirmar aceita appointmentId (transição CONFIRMED) ou holdId (conversão existente para
  PENDING_CONFIRMATION); estados seguem TASK-013, sem inferir confirmação por texto.
  Mutações de consulta exigem confirmação estruturada do chamador confiável por turno;
  parâmetro de confirmação não vem da IA. Handoff não aceita assignedUserId.
- ToolExecution ledger por tenant/conversation/callId registra intenção antes da mutação;
  hash de payload impede reutilização divergente. Resultado mutável mínimo permite replay.
  RUNNING após timeout/crash bloqueia reexecução; não prometer exactly-once entre commits.
  HOLD usa UUID do ledger como requestId; cancel/confirm/handoff/remarcação usam ledger.
  Replays revalidam autorização; handoff pode repetir resultado já concluído em NEEDS_HUMAN.
- Timeout não cancela magicamente transação: deadline checado antes da escrita/commit;
  corrida com commit pode concluir depois do timeout e ledger conserva resultado final.
  Até 8 chamadas por turno, 30s por turno, 5s por ferramenta; sem retries automáticos.
- Zod como fonte dos schemas e tipos, JSON Schema derivado para provider, sem importar SDK.
  Output projetado e validado, textos tratados como dados não instruções; logs allowlist.

## Arquivos e banco previstos

Módulo tools, tipos/registry/schemas/contexto/handlers/gateway/repository; boundary de
operação na autorização; extensão estreita de services catálogo/contexto e scheduling;
exports de módulos; revalidação nas transações existentes; testes unitários e integração.
Migration nova ToolExecution, FK composta conversa/tenant e índices de auditoria; sem
alterar migrations históricas. Documentar decisões em segurança/integrações/agenda.

## Critérios de aceite e testes

Cobrir os 60 cenários solicitados: schema/registry/limites; tenant/UUID/contexto manipulados;
ContactPatient revoked/declared/no_access; AI sem superpoder; estado/ownership; catálogo;
slots com bloqueio/consulta/HOLD/buffers; HOLD concorrente; confirmação/cancelamento/
remarcação/handoff via services; timeout/erro seguro/audit/idempotência concorrente.
Nenhum acesso externo pago; sem mudanças na Inbox ou disparo AI/WhatsApp.

## Validações

pnpm db:validate; pnpm db:migrate após revisão; pnpm lint; pnpm typecheck;
pnpm test; pnpm db:test (inclui cross-tenant, idempotência e concorrência); pnpm build;
git diff --check. Reexecutar verificações afetadas após corrigir erros.

## Riscos e rollback

RUNNING pode exigir reconciliação operacional após crash; não reexecutar automaticamente.
Escopo autenticado delegado é intencionalmente conservador. Busca limitada exige filtros
em clínicas grandes. Remover uso interno do módulo suspende tools; preservar ledger e
migration aditiva para manter auditoria/histórico. Sem implantação externa.

## Estado

Concluída em 2026-10-09. Plano criado antes da implementação. TASK-023 não iniciada.

## Implementação e decisões consolidadas

- ToolGateway interno, ToolRegistry explícito e ToolHandlers tipados para as dez tools.
  Uma fonte Zod produz validação e JSON schemas para integração futura, sem SDK específico.
  Não foi ativado tool calling no AIProvider ou criado endpoint de execução.
- Contexto opaco por request/turno, scope congelado e derivado de sessão real. Actor AI tem
  allowlist explícita intersectada com RBAC. Caller confiável aprova hash do payload exato
  nas três tools de confirmação/cancelamento/remarcação. Não há decisão textual de intenção.
- ContactPatient ativo VERIFIED/FULL ou SCHEDULING_ONLY autoriza apenas dados mínimos e
  agenda. DECLARED/REVOKED/NO_ACCESS nunca autorizam paciente. Catálogo e handoff não acessam
  paciente; handoff continua possível em problema de autorização. Contexto omite vínculos
  não autorizados e não expõe activePatientId sem vínculo permitido.
- Appointment/HOLD precisa corresponder ao contato e paciente ativos, além de tenant.
  USER em HUMAN_ACTIVE precisa ser responsável. AI só AI_ACTIVE; replay de handoff concluído
  em NEEDS_HUMAN não abre novo ciclo. Não existe escolha de atendente pela IA.
- SchedulingService e SchedulingRepository novos compõem helpers existentes; não havia
  serviço de busca final. 7 dias/20 slots/20 combinações, passo 15min, até 2000 conflitos por
  tipo/combinação. Timezone vem da unidade/clínica; UTC/offset explícito na entrada/saída.
  Duração override/buffers, regras/exceções, consultas e HOLDs ativos são considerados.
- Catálogo tem leitura estreita forAttendance com appointment.view, sem service.manage;
  edição continua protegida. Até 100 resultados ativos, sem preço/descrição/notas.
- Mutações usam serviços e transações existentes; boundary AsyncLocalStorage revalida
  contexto sob lock de Conversation/Patient, alvo e deadline dentro da escrita. Não altera
  autorização das rotas humanas sem boundary. Auditoria/eventos de domínio permanecem.
- ToolExecution inicia antes do despacho, preserva identidade/contexto/hash e registra
  sucesso/erro/duração/target. FKs compostas e unicidade tenant/conversation/callId. Resultados
  mutáveis mínimos cacheados; leituras não persistem conteúdo e exigem novo callId.
- HOLD usa UUID do ledger como requestId. Mesmo callId concorrente não despacha duas vezes;
  hash divergente recebe IDEMPOTENCY_CONFLICT. RUNNING bloqueia replay após timeout/crash.
  Falha de gravação final conserva RUNNING e gera log seguro; não repete operação.
- Limites configuráveis TOOL_CALLS_PER_TURN (8 padrão,1–16), TOOL_TIMEOUT_MS (5000 padrão,
  100–10000), TOOL_TURN_TIMEOUT_MS (30000 padrão,1000–60000); payload8KiB. Timeout inclui
  autorização e bloqueia escrita tardia. Transação já em commit pode concluir após timeout;
  ledger conserva resultado eventual. Nenhum retry automático ou garantia exactly-once.
- Logs allowlist sem argumentos/secrets; códigos seguros sem stack/SQL. Recusas com
  contexto autorizado também geram ledger; tentativa com contexto inválido não ganha
  permissão para escrever em outro tenant. Métricas deriváveis de status/duração/tool/tenant.

## Arquivos criados

- docs/exec-plans/TASK-022-tool-gateway.md
- apps/api/src/tools/tool.schemas.ts
- apps/api/src/tools/tool.errors.ts
- apps/api/src/tools/tool.config.ts
- apps/api/src/tools/tool-context.repository.ts
- apps/api/src/tools/tool-execution.repository.ts
- apps/api/src/tools/tool-gateway.service.ts
- apps/api/src/tools/tool.handlers.ts
- apps/api/src/tools/tools.module.ts
- apps/api/src/scheduling/scheduling.service.ts
- apps/api/src/scheduling/scheduling.repository.ts
- apps/api/src/permissions/operation-boundary.ts
- apps/api/test/tool-gateway.test.ts
- apps/api/integration/tool-gateway.test.ts
- packages/database/prisma/migrations/20261005030000_tool_gateway/migration.sql

## Arquivos alterados

- .env.example; compose.yaml; README.md; pnpm-lock.yaml.
- apps/api/package.json; apps/api/src/app.module.ts.
- apps/api/src/catalog/specialty.repository.ts; specialties.service.ts;
  service.repository.ts; services.service.ts; catalog.module.ts.
- apps/api/src/holds/hold.repository.ts; holds.module.ts.
- apps/api/src/appointments/appointment.repository.ts; appointments.module.ts.
- apps/api/src/conversations/conversation.repository.ts; conversations.module.ts.
- packages/database/prisma/schema.prisma.
- docs/architecture.md; domain-model.md; integrations.md; scheduling.md; security.md.

Alterações anteriores do workspace preservadas. Nenhum commit, PR, deploy, migração
histórica reescrita, alteração de frontend ou integração externa real nesta tarefa.

## Banco

Model ToolExecution adicionado; relações inversas em Tenant/Conversation/Contact/Patient.
FKs compostas tenant+conversation/contact/patient, onDelete/onUpdate Restrict. ActorId
é snapshot histórico de executor real, sem usuário artificial. Unique
(tenantId,conversationId,callId); índices (tenantId,createdAt)/(tenantId,correlationId).
CHECK de actor_type, formato SHA256 e estado/duração/conclusão. Não há enum Prisma novo.
Migration 20261005030000_tool_gateway aplicada localmente; suíte isolada validou instalação
do zero e reaplicação das 20 migrations, além do seed.

## Cobertura dos 60 cenários solicitados

- 1–7: registry explícito, JSON schemas derivados, tool desconhecida/extra/tipos/UUID,
  tenant em argumento rejeitado, correlação/callId preservado e fingerprint canônico.
- 8–16: contexto opaco, Conversation cross-tenant, patientId/tenantId/contactId injetados,
  FK ativa cross-tenant, Provider/Unit/Service externos, Appointment externo/inexistente,
  paciente diferente do mesmo tenant e rejeição de activePatientId no beginTurn.
- 17–22: REVOKED/NO_ACCESS/DECLARED, SCHEDULING_ONLY sem dado clínico, sessão/RBAC inclusive
  SUPER_ADMIN sem bypass, HUMAN_ACTIVE e RESOLVED/CLOSED bloqueiam AI; ownership USER.
- 23–32: contexto mínimo, catálogo ativo/scoped sem preços, busca real com timezone,
  override/buffers/BLOCK/Appointment/HOLD; slot obsoleto e concorrência de HOLD.
- 33–40: consulta autorizada, conversão/CONFIRMED/máquina de estados, cancelamento com
  histórico, remarcação transacional, handoff com motivo/sem assignedUserId/ciclo duplicado.
- 41–50: códigos seguros de nome/schema/403/404/conflito/expiração/timeout/interno,
  output validation, logs sem payload, ledger de sucesso e falhas críticas autorizadas.
- 51–55: replay mutável e concorrente, hash conflitante, cancel/confirm consistentes,
  handoff replay, RUNNING bloqueia retry, escrita tardia após timeout é impedida.
- 56–60: range/limit/payload/orçamento de turno, types/schemas e typecheck.
- Adicionais: revogação de vínculo e mudança para humano entre admissão/escrita, leitura
  revalidada após retorno do service, timeout inclui autorização e não despacha depois,
  handoff possível sem autorização de paciente, sem consulta/ação externa pelo modelo.

16 testes unitários novos; 23 subcenários PostgreSQL (24 contando a suíte). Os testes do
monorepo também exercitam as regressões de agenda, autenticação, tenancy, RBAC, handoff,
SLA, WebSocket e WhatsApp. Handlers são substituíveis em testes; sem banco em unit tests.

## Comandos e resultados finais

| Comando          | Resultado                                                     |
| ---------------- | ------------------------------------------------------------- |
| pnpm db:validate | Schema válido                                                 |
| pnpm db:migrate  | Nova migration aplicada com sucesso                           |
| pnpm lint        | 8 tarefas aprovadas                                           |
| pnpm typecheck   | 11 tarefas aprovadas                                          |
| pnpm test        | 140 testes: API118 + web16 + database3 + worker3; zero falhas |
| pnpm db:test     | API260 + database2 = 262; zero falhas                         |
| pnpm build       | 7 tarefas aprovadas                                           |
| git diff --check | Aprovado                                                      |

Também executados: pnpm --filter @atendente/api add zod; Prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script; builds/typecheck/test
direcionados da API/database; Prettier nos arquivos TypeScript afetados. SQL revisado antes
de aplicar. Logs de validação em /tmp/task022-*.log.

Correções encontradas nas validações: narrow do tipo de alvo HOLD; nome request-human;
separação e registro DI do SchedulingRepository; parâmetro de catálogo não utilizado;
timeout cobrindo autorização; política por finalidade preservando handoff sem acesso ao
paciente. Todas verificadas nas suítes finais, sem falha pendente.

## Limitações e riscos operacionais

- Execução AI é delegada por sessão humana real. Sem identidade autenticada apropriada,
  worker/WhatsApp não podem executar tools; conexão autônoma pertence à evolução futura.
- Crash/falha de finalização pode deixar RUNNING mesmo após commit. Reconciliar manualmente
  por ledger/audit de domínio; nunca apagar chave para provocar replay cego.
- Budgets são por turno interno, não rate limiter distribuído por tenant. Engine futuro
  precisa preservar esse limite sem emitir turnos ilimitados.
- Slots são amostrados a cada 15min e com limites explícitos; filtros menores podem ser
  necessários em clínicas grandes. HOLD continua sendo a autoridade para reserva.
- confirm_appointment com holdId retorna PENDING_CONFIRMATION, conforme conversão existente;
  appointmentId confirma. Não inferir que conversão equivale à confirmação textual.
- Texto em prosa exige minimização pelo chamador; schemas/outputs não são instruções.
- Não foi executado teste pago, fluxo WhatsApp real ou reconstrução das imagens Docker.
  Testes de navegador não foram repetidos pois não houve alteração de frontend.
- TASK-023 não iniciada.
