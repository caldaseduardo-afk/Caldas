# TASK-015 — Conversas

## Objetivo e escopo

Conversation e Message persistidas em PostgreSQL, contexto, estados/intenção,
mensagens/autoria, idempotência, recibos internos e listas paginadas. Sem Inbox UI,
WebSocket, envio, webhook/provider, IA, locks de atendente, handoff completo ou TASK-016.
Preservar alterações anteriores. Não vincular agenda a conversas nesta tarefa.

## Decisões de domínio

- Conversation com campos solicitados; canal WHATSAPP em enum extensível por migration
  futura (WEB/INSTAGRAM/OTHER não implementados). Inicial AI_ACTIVE/OTHER, sem atribuição,
  paciente e lastMessageAt nulos. AI_ACTIVE é estado, não execução de IA.
- Uma conversa aberta por tenant/contact/channel, considerando AI_ACTIVE,
  WAITING_PATIENT, NEEDS_HUMAN, HUMAN_ACTIVE. RESOLVED/CLOSED são históricas; obter/criar
  procura aberta e só cria se não existir. Unique parcial no banco protege concorrência;
  lock de Contact e transação Serializable com retry limitado. Alterar paciente não
  cria conversa. Sem reabertura de encerradas; depois de RESOLVED uma nova é permitida.
- activePatientId é contexto opcional. Definição exige patient.view, contato ativo e
  ContactPatient ativo VERIFIED com FULL/SCHEDULING_ONLY (mesma política de agendamento).
  Nenhuma resposta inclui dados clínicos. Contexto não concede acesso ao Patient:
  PatientAccessService continua exigindo FULL em cada acesso contextual. Revogação
  posterior não transforma ID histórico em autorização.
- assignedUserId opcional com FK UserTenant; somente operação interna autorizada de
  transição pode definir ao entrar HUMAN_ACTIVE, após validar membro/usuário/role
  ativo e conversation.view/reply. Sem endpoint de atribuição, locks/ownership ou takeover.
- Estados centralizados: AI_ACTIVE -> WAITING_PATIENT/NEEDS_HUMAN/RESOLVED;
  WAITING_PATIENT -> AI_ACTIVE/NEEDS_HUMAN/RESOLVED;
  NEEDS_HUMAN -> HUMAN_ACTIVE (somente interno com atribuição válida);
  HUMAN_ACTIVE -> AI_ACTIVE/WAITING_PATIENT/RESOLVED;
  RESOLVED -> CLOSED; CLOSED terminal. Sem transições arbitrárias/reabertura.
  NEEDS_HUMAN exige motivo, default OTHER; sair dele limpa motivo. Sair HUMAN_ACTIVE
  limpa assignedUserId. Retorno público para HUMAN_ACTIVE é recusado nesta etapa.
- intent independente e mutável nas conversas abertas. Encerradas não aceitam alterações
  de contexto/intenção ou novas mensagens; recibos e retries idempotentes de mensagens
  já existentes continuam possíveis. Mensagem não altera estado/intenção implicitamente.

## Autoria, mensagens e idempotência

USER público deriva usuário da sessão, nunca do payload. PATIENT (quem fala é Contact),
AI e SYSTEM possuem funções internas separadas, ainda exigindo contexto/permissões;
sem controller genérico para escolher autor. Não criar usuário artificial. SYSTEM é
interno por natureza e nada nesta task publica mensagens em canal externo.

Tipos TEXT/IMAGE/AUDIO/DOCUMENT/LOCATION/CONTACT/INTERACTIVE. Content textual até4000;
TEXT exige texto; outros permitem caption vazio. Metadata JSONB com DTO estruturado
por tipo: mídia usa mediaRef opaco limitado e mimeType/fileName/sizeBytes opcionais;
LOCATION latitude/longitude/label; CONTACT displayName/phone; INTERACTIVE interactionId/
selectionId. Sem blobs, base64/data URI ou payload arbitrário. Sem processamento de mídia.

Message guarda channel para unique (tenant,channel,providerMessageId), FK composta
para Conversation incluindo channel impede divergência. Apenas WHATSAPP nesta etapa;
antes de múltiplas contas/providers por canal a chave deverá incluir provider/account.
providerMessageId nulo permite mensagens internas repetidas. Ingresso PATIENT interno
exige ID externo; AI/SYSTEM e USER têm ID externo nulo nesta tarefa. Repetição do mesmo
ID/mesma conversa/conteúdo/tipo/metadata retorna registro existente; uso em outra conversa
ou payload diferente =409 genérico. Sem deduplicação por conteúdo/timestamp.

Persistir mensagem, atualizar lastMessageAt e auditar numa transação antes de retornar.
Sem callback/processamento IA. Lock de Conversation via UPDATE; relógio PostgreSQL
clock_timestamp após lock gera createdAt e lastMessageAt igual (ou máximo existente).
Constraint trigger derivará lastMessageAt em gravação direta de Message para integridade.
Receipts internos validam createdAt <= deliveredAt <= readAt <= agora; read implica
entrega se ausente. Repetição do mesmo recibo não duplica auditoria; conflito de timestamp
é rejeitado. Sem endpoint público para falsificar recibo/providerId/data de criação.

## API, permissões e paginação

POST /conversations {contactId,channel?}: obter/criar; GET /conversations com filtros
status/intent/assignedUserId/contactId/activePatientId/channel e page/limit;
GET /conversations/:id; PATCH /conversations/:id {activePatientId?,intent?};
POST /conversations/:id/status {status,handoffReason?};
POST /conversations/:id/messages {messageType,content?,metadata?} autoria USER;
GET /conversations/:id/messages; GET /conversations/:id/messages/:messageId.

Leitura conversation.view+contact.view; escritas acrescentam conversation.reply;
encerrar/resolver exige conversation.close; selecionar paciente patient.view adicional.
Transição interna para HUMAN_ACTIVE exige conversation.assign; do humano para IA exige
conversation.transfer. Sem ampliação da matriz RBAC existente. Services/repositories
validam; SQL inclui tenant e autorização. Foreign IDs retornam 404; filters tenant-scoped
não revelam registros estrangeiros. Atribuição interna valida alvo, sem confiar no ID.

Paginação simples page>=1/limit1..100 (default1/20), offset limitado a10000 registros.
Retorno {items,page,limit,hasMore}, consulta limit+1. Mensagens createdAt/id ASC;
conversas lastMessageAt DESC nulls last, createdAt DESC/id DESC. Offset não promete
snapshot estável durante inserções; suficiente para base da inbox, sem histórico ilimitado.
Projeções omitem tenantId, dados pessoais expandidos e timestamps técnicos de configuração;
Message expõe createdAt/recibos, necessários à ordem, sem segredo do provider.

## Banco e arquivos

Schema: Conversation, Message; enums ConversationChannel/Status/Intent, HandoffReason,
MessageSenderType/MessageType; AuthEvent tipos CONVERSATION_CREATED/UPDATED/STATUS_CHANGED,
MESSAGE_CREATED/RECEIPT_UPDATED. FKs tenant/contact/patient/assigned member/conversation/
sender member compostas; delete Restrict. Índices inbox por tenant e contato/status,
paciente/status, atribuição/status, intent/status, canal/lastMessageAt e tenant/createdAt.
Message índices tenant/conversation/createdAt/id e tenant/senderType/createdAt; unique
externo cobre provider ID, sem índices de recibo/tipo ainda sem consultas dedicadas.
CHECK autoria USER/par usuário, intervalos de recibos e conteúdo; unique parcial de aberta.
Migration nova revisada sem tocar históricas. Módulo conversations + testes + AppModule;
docs de conversas/domínio/README atualizados apenas com decisões desta implementação.

## Testes, aceite e validação

Cobrir 50 cenários solicitados: cross-tenant, RBAC, contexto vs autorização, transições,
idempotência serial/concorrente, rollback, autoria interna/pública, receipts, tipos/metadata,
lastMessageAt, paginação/ordem/filtros, constraints físicas e concorrência de obter/criar.
Prisma format/generate/validate; pnpm lint/typecheck/test/db:test/build; format:check;
git diff --check. Migrations do zero/reaplicadas em banco descartável antes do deploy
local; prisma migrate status/diff e smoke compilado. Nenhum efeito em providers externos.

## Riscos e rollback

Atual escopo tem um canal/provider lógico por tenant; identidade de conta externa futura
precisa estender idempotência. Sem autenticação de contato/provider nesta tarefa: funções
internas não são webhook nem atalho sem tenant. Metadata guarda referências, sem resolver
ou autorizar download de anexos ainda inexistentes. Sem nota interna USER completa:
SYSTEM permanece interno; visibility será tratado com fluxo de notas futuro.
Rollback por migration compensatória preservando mensagens/auditoria; não apagar histórico
nem remover proteção com rotas ativas. Não avançar TASK-016/018.

## Resultado

Implementação concluída, limitada à TASK-015.

### Arquivos criados

- apps/api/src/conversations/conversation-access.ts
- apps/api/src/conversations/conversation.dto.ts
- apps/api/src/conversations/conversation.state.ts
- apps/api/src/conversations/conversation.repository.ts
- apps/api/src/conversations/conversations.service.ts
- apps/api/src/conversations/conversations.controller.ts
- apps/api/src/conversations/conversations.module.ts
- apps/api/test/conversations.test.ts
- apps/api/integration/conversations.test.ts
- packages/database/prisma/migrations/20261002030000_conversations/migration.sql
- docs/exec-plans/TASK-015-conversations.md

### Arquivos alterados nesta tarefa

- packages/database/prisma/schema.prisma
- apps/api/src/app.module.ts
- docs/conversations.md
- docs/domain-model.md
- README.md

Sem alteração de dependências, worker, UI ou migrations históricas. Preservadas as
alterações anteriores. Conversas não foram acopladas à agenda nesta tarefa.

### Models, enums e índices

Conversation e Message novos; relações reversas em Tenant, Contact, Patient,
ContactPatient e UserTenant. Seis enums: ConversationChannel, ConversationStatus,
ConversationIntent, HandoffReason, MessageSenderType e MessageType. Cinco eventos
AuthEventType conforme plano. FKs compostas incluem tenant, canal e vínculo do paciente.

Índices: Conversation tenant/contact/status, tenant/activePatient/status,
tenant/assignedUser/status, tenant/intent/status, tenant/channel/lastMessageAt,
tenant/createdAt; Message tenant/conversation/createdAt/id e tenant/senderType/createdAt.
Uniques tenant/id, Conversation tenant/id/channel, Message tenant/channel/providerId;
unique parcial de aberta por contato/canal. CHECKs de autoria, atribuição, motivo,
conteúdo/metadata e recibos; trigger AFTER INSERT mantém lastMessageAt. Campos de
recibo/tipo de mensagem não ganharam índices separados sem consulta dedicada.

### Testes e validação

4 grupos unitários: matriz de estados, DTOs de contexto/atribuição, autoria/metadata
por tipo e paginação/recibos com datas válidas. 11 grupos de integração: obter/criar
concorrente em duas APIs, contexto vs autorização clínica, autoria, deduplicação
concorrente e serial, tipos, lastMessageAt/ordenação/paginação, filtros, estados,
atribuição, recibos, cross-tenant/RBAC/CSRF, constraints, rollback de auditoria e
revogação/contexto ausente. Os 50 cenários solicitados estão cobertos nesses grupos
mais verificação dos índices na migration. Nenhuma rota permite forjar autor/data.

Correções durante implementação: fechamento sintático do model Message, seleção
User.status ACTIVE conforme modelo existente e validação completa de datas de recibo.

Comandos executados: prisma format; pnpm --filter @atendente/database build;
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script;
pnpm lint; pnpm typecheck; pnpm test; pnpm db:test; pnpm build; pnpm db:validate;
pnpm format:check; git diff --check; pnpm db:migrate; prisma migrate status;
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code.
Migration revisada antes de aplicar; banco descartável testa criação do zero,
reaplicação e seed idempotente antes do deploy local.

Resultados: lint 8 tarefas, typecheck 10 tarefas e build 7 tarefas aprovados.
52 testes unitários (API 45, database 3, worker 3, web 1) e 140 de integração
(API 138, database 2) aprovados, incluindo regressões anteriores e concorrência.
Prisma validate, format:check e git diff --check aprovados.

### Limites preservados

Sem erros funcionais pendentes encontrados. Uma conta/provider lógico por canal/tenant;
chave externa deve evoluir antes de múltiplas contas. Operações internas ainda dependem
de contexto autenticado/autorizado, sem webhook ou bypass. Receipts não comprovam
entrega real sem provider. Mensagem USER apenas persiste: não significa envio efetuado.
SYSTEM não sai para canal externo. Sem nota interna USER, sumarização, IA ou processamento
de anexo; referências não são resolvidas. Paginação offset não garante snapshot durante
inserções. Sem locks de atendente ou Inbox UI; não avançar TASK-016/018.

Migration 20261002030000_conversations aplicada no PostgreSQL local; 14 migrations
atualizadas, sem diferença schema/banco. Smoke compilado: /health 200 e
/conversations sem sessão 401; API encerrou normalmente. Imagens Docker não refeitas.
