# TASK-020 — WhatsApp Provider

## Objetivo e escopo

Implementar exclusivamente o transporte oficial WhatsApp Cloud API, webhook autenticado,
persistência inbound, envio humano durável e recibos na Inbox existente. Não implementar
IA, engine, tools, automações, templates completos, downloads de mídia ou TASK-021.

## Decisões antes da implementação

- MessagingProvider entrega eventos normalizados; aplicação de conversas decide contato,
  conversa e persistência. Reutilizar normalização da TASK-007 e regras da TASK-015/018.
- Integration ainda não existe no Prisma: adicionar entidade genérica com provider/type,
  tenant, phoneNumberId, externalAccountId, status e credentialsReference. Provisionamento
  é administrativo via comando, não permitir que administrador de clínica reivindique
  número de outra clínica por simples ID. Vários números por tenant, número único global
  dentro do provider. Referência aponta a variável WHATSAPP_ACCESS_TOKEN_<alias>; nenhum
  token no banco. App secret/verify token globais representam uma única aplicação Meta.
- Acrescentar integrationId opcional em Conversation/Message. Conversas integradas são
  abertas por tenant/contato/canal/integração; históricas sem integração permanecem locais
  e não são enviadas automaticamente. Idempotência externa inclui integração e tenant,
  mantendo proteção equivalente para mensagens legadas sem integração.
- GET verifica challenge/token; POST exige HMAC-SHA256 dos bytes originais, antes de
  processar JSON. Exceção de Origin só para rota marcada como webhook, nunca para login.
  Limite específico de payload 256 KiB, lotes limitados; demais rotas continuam 8 KiB.
- Inbound faz somente operações de banco limitadas, responde após commit, eventos realtime
  após commit; duplicados são sucesso. Sem chamada externa/IA no processamento inbound.
  Contato inativo não é reativado por webhook. Não inferir Patient ou autorização clínica.
- Referências de mídia e metadata limitadas, sem binários/download. Tipos externos não
  suportados são ignorados de modo seguro e observável. Não persistir payload bruto.
- Outbound humano mantém RBAC e ownership, grava Message PENDING e requestId antes do envio.
  UUID por intenção de frontend; constraint tenant/autor/requestId. Message é outbox,
  worker BullMQ único usa IDs e revalida destino/integração. Não segurar transação em HTTP.
- Retries limitados com backoff para rejeições explicitamente transitórias. Resultado
  incerto (timeout/conexão encerrada/processo morto após envio) não permite reenvio
  automático: FAILED/SEND_UNCERTAIN, reconciliável por callback correlacionado. Não há
  garantia de exactly-once na API externa; preferir evitar duplicação silenciosa.
- Recibos monotônicos, tolerantes a repetição/fora de ordem; timestamps do provider em UTC,
  normalizados para integridade temporal interna. Callback opaco contém UUID interno,
  sempre validado com integração/tenant/destinatário. Nunca muda Conversation.status.
- Reutilizar barramento WebSocket/QueueEvents e audit existente. Logs estruturados com
  IDs, resultado, duração e código seguro; nunca conteúdo, telefone, credenciais ou erro cru.

## Arquivos e banco previstos

Prisma schema e nova migration; interface em packages/domain; provider/worker infraestrutura
em packages/database; módulo messaging e ingresso de conversas na API; bootstrap/guard;
worker existente; composer e estados de mensagem na web; testes unitários, integração,
concorrência/WebSocket e navegador; .env.example, README e docs relevantes.
Models: Integration, campos de roteamento/outbox/status em Conversation/Message.
FKs compostas por tenant, índices de roteamento/deduplicação e despacho, constraints de
estado/autor/retries. Nenhuma migration histórica será editada.

## Testes e critérios de aceite

Cobrir os 50 cenários do pedido: verificação/assinatura/schema; todos os tipos; contatos,
normalização e não criação de Patient; duplicação concorrente; múltiplos tenants/números;
persistência antes de evento; RBAC/ownership; envio, erro sanitizado, retries, recibos
repetidos/fora de ordem; eventos sem vazamento; credenciais ausentes de responses/audit/logs.
Usar HTTP provider simulado e PostgreSQL/Redis reais isolados. Não enviar mensagens reais.

## Comandos de validação

- pnpm db:validate
- pnpm db:migrate (após revisar SQL novo)
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test (inclui webhook, idempotência, concorrência, provider e WebSocket)
- pnpm --filter @atendente/web test:e2e
- pnpm build
- git diff --check

## Riscos e rollback

Credenciais/conta Meta não fornecidas: validar protocolo com mocks, documentar ativação real
por operador e callback HTTPS. Janela de atendimento pode exigir template, sem bypass nem
resposta automática. Falhas de transporte ambíguas exigem reconciliação, não retry cego.
WebSocket permanece best-effort; REST é canônico. Desativar integração/worker suspende envio;
preservar mensagens e migration aditiva para rollback operacional (não apagar histórico).

## Estado

Concluída em 2026-10-05. Plano criado antes das alterações de implementação.
TASK-021 não iniciada.

## Implementação e decisões consolidadas

- Interface de domínio MessagingProvider e WhatsAppProvider com HTTP oficial, parsing de
  sete tipos, HMAC, verificação GET, erros sanitizados e métodos texto/mídia/interativo.
- Integration configurada somente por operador; uma aplicação Meta e várias contas/números.
  Não foi criado CRUD público que permita reivindicar um phoneNumberId conhecido.
- Novo helper getOrCreateConversation compartilhado por REST e ingresso normalizado.
  Conversas legadas sem integração são preservadas; não houve envio retroativo/backfill.
- Message é a própria outbox, evitando uma tabela redundante. Worker usa estado/claim SQL,
  cinco tentativas externas no máximo, backoff 5/10/20/40s e lease de 120s. Redis só agenda.
  Conclusões/expiração publicam message.status_updated via QueueEvents/barramento existente.
- Revalidação de permissões/ownership no worker além da autorização de intenção; revogar
  vínculo ou transferir antes do claim impede chamada externa. HTTP é fora da transação.
- Callback pode reconciliar UUID de tentativa iniciada, inclusive resultado incerto; valida
  integração/tenant/destino e provider ID. FAILED do provider confirma falha antes incerta;
  entrega/leitura posteriores recuperam estado sem novo envio. Recibos são monotônicos.
- Mídia não é baixada; CONTACT guarda primeira ficha/telefone compatível com DTO existente.
  Sem templates: rejeição por janela/política é permanente e preserva Message. Tipos externos
  não suportados são ignorados com 200; payload suportado inválido retorna 400. Inativos
  não são reativados. Timestamps de criação são de ingresso UTC; recibos usam tempo Meta
  limitado à ordem temporal interna, considerando precisão em segundos do provider.
- Mensagens antigas/locais continuam LOCAL. Respostas integradas somente TEXT nesta etapa.
  Estado da entrega é separado do estado de atendimento. Não há UI de integração nem IA.

## Arquivos criados nesta tarefa

- docs/exec-plans/TASK-020-whatsapp-provider.md
- packages/domain/src/messaging-provider.ts
- packages/database/src/whatsapp-provider.ts
- packages/database/src/messaging-delivery.ts
- packages/database/src/messaging-queue.ts
- packages/database/src/configure-whatsapp.ts
- packages/database/prisma/migrations/20261005000000_whatsapp_provider/migration.sql
- packages/database/prisma/migrations/20261005010000_whatsapp_recipient_guard/migration.sql
- apps/api/src/conversations/conversation-create.ts
- apps/api/src/conversations/conversation-ingress.service.ts
- apps/api/src/messaging/whatsapp-webhook.controller.ts
- apps/api/src/messaging/messaging.bridge.ts
- apps/api/src/messaging/messaging.module.ts
- apps/api/test/whatsapp-provider.test.ts
- apps/api/integration/whatsapp.test.ts
- apps/web/e2e/whatsapp.spec.ts
- apps/web/test/whatsapp.test.tsx

## Arquivos alterados nesta tarefa

- .env.example; compose.yaml; package.json; pnpm-lock.yaml; README.md.
- packages/domain/src/index.ts.
- packages/database/package.json; src/index.ts; prisma/schema.prisma.
- apps/api/package.json; src/app.module.ts; src/bootstrap.ts; src/auth/auth.guard.ts.
- apps/api/src/conversations/conversation.repository.ts; conversation-access.ts;
  conversation.dto.ts; conversations.service.ts; conversations.module.ts.
- apps/api/src/inbox/inbox.repository.ts; src/realtime/realtime.events.ts.
- apps/worker/src/main.ts.
- apps/web/components/inbox/messages.tsx; inbox.tsx; lib/inbox.ts; lib/realtime.ts;
  e2e/inbox.spec.ts (assertion agora inclui requestId).
- docs/integrations.md; architecture.md; conversations.md; domain-model.md; security.md.

As alterações anteriores a TASK-020 já presentes no workspace foram preservadas.
Não foram criados commits, executado provisionamento real ou enviada mensagem externa.

## Banco e índices entregues

Migration principal adiciona Integration, enums IntegrationType/Provider/Status e
MessageDeliveryStatus, campos de integração/status/outbox e tipos de auditoria. FKs
compostas preservam tenant. Índices: Integration(provider,phoneNumberId) único,
Integration(tenantId,type,status), uniques tenant/id; Conversation aberta única por
contato/canal/integração e índice separado legado; Message externa única por
(tenantId,integrationId,providerMessageId), parcial legado, única por
(tenantId,senderUserId,requestId), despacho (deliveryStatus,nextAttemptAt,id).
Índices ContactChannel(address/providerExternalId) existentes são suficientes.

CHECKs validam configuração/referência sem secrets, limites/estados/autor/destino do envio;
triggers impedem divergência de integração e reatribuição de Conversation. Na revisão,
a semântica SQL UNKNOWN exigiu IS NOT NULL explícito no destinatário: corrigido na segunda
migration aditiva, pois a primeira já estava aplicada. Nenhuma migration aplicada foi
reescrita. Ambas aplicadas no banco local; teste isolado valida também instalação do zero.

## Cobertura dos cenários solicitados

- 1–4, 25, 41–43, 49: challenge/token, assinatura/bytes, schema/limites, tenant por número
  e WABA, Integration ausente/desativada, proteção Origin preservada fora do webhook.
- 5–8, 14–22, 45–46: sete tipos, normalização existente, Contact provisório/canal principal,
  reutilização PHONE, não criar Patient, conversas abertas/históricas, autoria imposta,
  metadata limitada sem binário, lastMessageAt atômico.
- 9–13, 23–24, 44: evento após commit e sockets reais A/B; duplicação/reentrega concorrente,
  unicidade isolada por tenant/número, resposta genérica sem expor IDs externos alheios.
- 26–35, 40, 47–48, 50: intenção antes de HTTP, provider ID, concorrência de envio,
  UUID repetido/payload conflitante, falha persistida, limite/backoff, resultado incerto,
  autorização/ownership/revogação/tenant, autoria, sanitização de logs/responses/audit.
- 36–39: delivered/read/failed reais simulados via webhook, duplicados/fora de ordem,
  callback precoce/tardio, destinatário errado e isolamento de Integration/tenant.
- Adicionais: Redis perde job e recupera da outbox; BullMQ real; lease expirado não reenvia;
  FK/constraints cross-tenant/destino nulo; Inbox conserva chave ao repetir HTTP e atualiza
  status via evento sem duplicar bolha; testes existentes de SLA/handoff permanecem.

## Limitações operacionais

Não houve homologação com conta Meta real: requer versão/credenciais/número/callback HTTPS
configurados pelo operador. Não foi executado whatsapp:configure contra conta real.
Templates e downloads/transcrição estão fora do escopo. Resultado externo incerto não
pode receber garantia exactly-once: conservar registro e reconciliar callback/operador.
Sem versão, consumidor WhatsApp fica desligado; configurar antes de habilitar Integration.
O build foi validado localmente, sem reconstruir/reiniciar containers de aplicação.

## Validações finais — 2026-10-05

| Comando                               | Resultado                                                    |
| ------------------------------------- | ------------------------------------------------------------ |
| pnpm db:validate                      | Schema válido                                                |
| pnpm db:migrate                       | Duas migrations novas aplicadas localmente                   |
| pnpm lint                             | 8 tarefas aprovadas                                          |
| pnpm typecheck                        | 11 tarefas aprovadas                                         |
| pnpm test                             | 90 testes: API 68, web 16, database 3, worker 3; zero falhas |
| pnpm db:test                          | 224 testes API + 2 database = 226; zero falhas               |
| pnpm --filter @atendente/web test:e2e | 20 testes aprovados                                          |
| pnpm build                            | 7 tarefas aprovadas                                          |
| git diff --check                      | Aprovado                                                     |

A suíte PostgreSQL/Redis isolada valida migrations do zero, reaplicação e seed; inclui
27 testes (26 subcenários + suíte) específicos de WhatsApp, além das regressões anteriores.
Provider HTTP simulado valida o contrato oficial sem uso de credenciais externas.
WebSocket e BullMQ são reais nos testes de integração. Navegador usa transporte controlado.

Também executados pnpm --filter @atendente/api add express@^5.2.1 (raw-body específico),
Prisma migrate diff para gerar a migration principal, builds/typechecks direcionados e
Prettier sobre os arquivos de implementação. Express mantém a mesma versão já transitiva
no workspace, agora declarada diretamente porque bootstrap usa raw().

Correções realizadas antes do fechamento: tipos das fixtures; chave de idempotência no
assertion antigo do composer; recipient NULL em CHECK SQL; recibo FAILED confirmando erro
antes incerto; perfil sem nome usa rótulo neutro; destinatário e autoria revalidados;
recuperação de lease reutiliza o mesmo processamento do worker sem rotina duplicada.
Não há erro de validação pendente. Ativação/homologação real e reconstrução das imagens
são etapas operacionais não executadas nesta entrega. Não avançar para TASK-021.
