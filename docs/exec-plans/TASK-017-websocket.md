# TASK-017 — WebSocket

## Objetivo e escopo

Atualizar Inbox após commits de Conversation/Message, com conexão autenticada,
isolamento tenant/RBAC, deduplicação e recuperação após reconexão. Somente TASK-017;
sem handoff, lock, IA, WhatsApp, presença, typing ou CRUD pelo socket.

## Decisões técnicas

- WebSocket nativo (`ws` no Nest, WebSocket do navegador); não havia biblioteca
  realtime. Serviço singleton conectado ao HTTP server do Nest, ciclo de vida
  explícito, sem depender de guards HTTP em um upgrade WebSocket.
- `/realtime` na mesma origem via rewrite Next para API_INTERNAL_URL. O código local
  Next suporta proxy de upgrade em rewrites externos; validar em teste real.
- Cookie HttpOnly existente e Origin exata de AUTH_ORIGIN. Sem token/query de
  tenant, sem nova credencial. Reutilizar AuthService.authenticate e filtros SQL
  authorizedTenantFilter: conversation.view + contact.view.
- Room equivalente: mapa de conexões por tenant obtido da sessão. Não existem
  subscriptions arbitrárias nem mensagens client→server. Conhecer IDs não autoriza.
- Revalidar sessão, usuário, tenant, vínculo e RBAC antes de cada entrega e no
  heartbeat (20s). Logout/troca de tenant invalidam imediatamente conexões locais
  da sessão após commit; validação periódica cobre revogações administrativas.
- Eventos internos separados do transporte. Repository coleta eventos durante a
  transação; publica somente após $transaction resolver. Retry/rollback descarta
  eventos pendentes. Operações idempotentes não publicam novamente.
- Eventos: conversation.created, conversation.updated (inclui contexto),
  conversation.status_changed, conversation.assigned,
  conversation.active_patient_changed, message.created, message.delivered,
  message.read. Payload {eventId,type,tenantId,conversationId,messageId?}; nenhum
  conteúdo, paciente, token ou snapshot sensível. IDs gerados pelo servidor.
- Cliente invalida/refaz somente lista e conversa ativa afetada; estado sempre
  vem de REST autorizado. Eventos fora de ordem não aplicam snapshots antigos.
  Deduplicar eventId com memória limitada e mensagens por id; abortar leituras
  obsoletas. Preservar composer e histórico durante atualização em background.
- Uma conexão por Workspace/sessão, nunca por item. Cleanup fecha conexão e timers.
  Backoff exponencial com jitter até 30s; reconectar ressincroniza lista, contexto
  e mensagens. Sem polling REST agressivo e sem dependência de replay perfeito.
- Ping/pong do protocolo ws, limite de payload e buffer para conexões lentas.
  Logs estruturados apenas de IDs/tipos/estado; sem cookies/conteúdo de mensagens.

## Arquivos afetados

Backend realtime (event bus, gateway, module), ConversationRepository e module,
AuthService/AuthModule, TenantRepository/TenancyModule e registro AppModule.
Frontend hook/service realtime, Inbox/MessageList/useRemote e Next config.
Testes unitários, integração PostgreSQL+WebSocket real e navegador. README e
conversations/security/architecture somente para registrar decisões relevantes.

## Banco

Sem models, migrations ou índices novos. PostgreSQL permanece fonte de verdade.
Não implementar outbox distribuída; crash entre commit/publicação pode perder aviso,
recuperado por ressincronização na reconexão/atualização manual.

## Riscos e limites

Instância única; múltiplas instâncias exigirão barramento compartilhado/adapter
Redis e estratégia de publicação durável. Não prometer entrega exatamente uma vez.
Revogações silenciosas encerram sockets em até um heartbeat, mas cada evento
revalida acesso. Unidade não tem escopo de conversa independente no modelo atual;
a política coincide com a Inbox REST, sem introduzir novo modelo de autorização.

## Testes e aceite

Conexão autorizada; cookies/Origin inválidos; usuário inativo; sessão inválida;
sem permissões; isolamento A/B bidirecional; IDs estrangeiros; publicação somente
após commit; rollback; autores; status/atribuição/paciente/recibos; idempotência;
logout/troca de tenant/revogação; heartbeat/cleanup. Navegador: duas janelas,
lista/histórico/ordem, duplicatas, eventos antigos, desconexão/reconexão/refetch,
sem listeners duplicados, REST continua disponível, HTML permanece escapado.

## Validação

Executar sequencialmente onde há artefatos compartilhados:

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test (inclui integração WebSocket)
- pnpm --filter @atendente/web test
- pnpm --filter @atendente/web test:e2e
- pnpm build
- git diff --check

## Rollback

Desabilitar rewrite/conexão e remover módulo realtime/publicação; a Inbox REST
continua funcional, sem reversão de schema nem perda de dados persistidos.

## Entrega — 2026-10-03

Criados:

- `apps/api/src/realtime/realtime.events.ts`: barramento interno e invalidação de
  sessão, sem dependência de transporte.
- `apps/api/src/realtime/realtime.gateway.ts`: autenticação/upgrade, rooms por
  tenant, autorização por entrega, heartbeat, backpressure, logs e cleanup.
- `apps/api/src/realtime/realtime.module.ts`: composição com autenticação/banco.
- `apps/api/test/realtime.test.ts`: barramento, sanitização e cleanup.
- `apps/api/integration/realtime.test.ts`: PostgreSQL + sockets reais, incluindo
  upgrade por Next, rollback e ciclo de sessão.
- `apps/web/lib/realtime.ts`: protocolo, dedup, lotes e reconexão.
- `apps/web/lib/use-realtime.ts`: conexão única e lifecycle do Workspace.
- `apps/web/test/realtime.test.tsx`: protocolo, timers/listeners, backoff e merge.
- `apps/web/e2e/realtime.spec.ts`: duas janelas, ordem, contexto, reconexão e cleanup.
- `apps/web/next.config.mjs`: rewrite same-origin para upgrade.
- Este plano.

Alterados nesta tarefa:

- `apps/api/src/conversations/conversation.repository.ts` e
  `conversations.module.ts`: eventos coletados durante a transação e emitidos
  após commit, preservando idempotência e contratos REST.
- `apps/api/src/auth/auth.service.ts`, `auth.module.ts` e `auth.guard.ts`:
  reutilização de autenticação/cookie e invalidação após login/logout.
- `apps/api/src/tenancy/tenant.repository.ts` e `tenancy.module.ts`:
  invalidar conexões da sessão após selecionar tenant.
- `apps/api/src/app.module.ts`: registro do módulo.
- `apps/api/package.json`, `pnpm-lock.yaml`: `ws` 8.22.0 e `@types/ws` 8.18.2
  (tipos apenas desenvolvimento). Frontend usa WebSocket nativo, sem dependência.
- `apps/web/components/inbox/inbox.tsx`: conexão única, invalidação direcionada e
  estado discreto de conexão; refresh não desmonta composer.
- `apps/web/components/inbox/conversation-list.tsx`: atualização em background.
- `apps/web/components/inbox/messages.tsx`: atualização/dedup do histórico sem
  desmontar a conversa a cada evento.
- `apps/web/lib/inbox.ts`, `use-remote.ts`: merge canônico e preservação do snapshot
  durante refetch da mesma URL; respostas antigas continuam abortadas/ignoradas.
- `apps/web/app/globals.css`: estado de conexão no rodapé.
- `turbo.json`: API_INTERNAL_URL permitido e incluído na chave de cache; rewrite
  não pode reutilizar build de outro destino/ambiente.
- `README.md`, `docs/conversations.md`, `docs/security.md`, `docs/architecture.md`:
  configuração, contratos, política e limites.

Nenhum model, enum, índice ou migration foi criado/alterado nesta tarefa.
Nenhum endpoint de escrita novo; `/realtime` aceita apenas upgrade autenticado.

## Validação final

- `pnpm lint`: aprovado, 8 tarefas.
- `pnpm typecheck`: aprovado, 10 tarefas.
- `pnpm test`: aprovado, 68 testes (48 API, 3 banco, 3 worker, 14 web).
- `pnpm --filter @atendente/web test`: aprovado, 14 testes.
- `pnpm db:test`: aprovado, 173 testes API + 2 banco. Inclui 20 cenários da suíte
  WebSocket real e seu teste agregador. Migrations históricas do zero/reaplicação e
  seed idempotente aprovados em PostgreSQL isolado; sem mudança no banco local.
- `pnpm --filter @atendente/web test:e2e`: aprovado, 16 testes Chromium
  (12 da Inbox + 4 cenários realtime, incluindo duas janelas).
- `pnpm build`: aprovado, 7 tarefas.
- `git diff --check`: aprovado.
- Instalação: `pnpm --filter @atendente/api add ws` e
  `pnpm --filter @atendente/api add -D @types/ws`.
- Prettier aplicado nos arquivos trabalhados e documentação relacionada.

Os testes de navegador identificaram uma abertura transitória extra no Strict Mode
React. O hook passou a adiar abertura até permitir cleanup do efeito de verificação;
reexecução confirma uma conexão por janela mesmo trocando várias vezes de conversa.
Erros iniciais de tipo nos fixtures foram corrigidos antes das validações finais.

### Cobertura dos cenários do pedido

- 1–7, 22–23, 26–35: integração PostgreSQL/sockets reais, autenticação, A/B
  bidirecional, RBAC revogado, pós-commit, rollback sem evento, IDs estrangeiros,
  tipos de autor, lastMessageAt, logout e sessão/usuário/tenant inválidos.
- 8–11: eventos de atualização, status, paciente, atribuição interna e recibos;
  testes HTTP/internos com gateway real, sem introduzir handoff/provider.
- 12–18, 24, 36: navegador/merge unitário, duas janelas, mensagem única, ordenação,
  duplicatas, evento antigo, reconnect e refetch do estado canônico.
- 19–21, 25, 37–38: REST permanece independente, estado de reconexão, uma conexão,
  troca de conversa/tenant, timers/listeners e desmontagem/logout.
- 39–40: lint/typecheck globais aprovados; build completo também aprovado.
- Extra: ping/pong saudável e cliente sem pong; proxy Next real preservando Cookie
  e Origin no upgrade; barramento tolerando consumidor que lança erro.

Testes de navegador usam transporte/REST controlados apenas em fixtures. Persistência,
segurança e encaminhamento são verificados separadamente com banco/socket/Next reais.

## Limites e operação

- Instância única, eventos em memória, sem replay durável ou promessa de exactly-once.
  Crash após commit pode perder aviso; reconexão/refresh recupera o banco.
- Mudanças SQL diretas não publicam automaticamente. Não há CDC/outbox nesta etapa.
- Sessão ociosa revogada por administração é encerrada até o próximo heartbeat
  de 20s; toda entrega valida acesso novamente, sem janela de autorização por cache.
- Conexão perdida não impede REST; durante queda não há promessa de tempo real.
- Desconexão por excesso de buffer/fila leva à reconexão e ressincronização.
- Rewrites usam API_INTERNAL_URL do build Next; Turborepo inclui a variável no hash.
  Deploy deve permitir upgrade e conexões longas, com HTTPS/WSS em produção.
- Sem WhatsApp, recibos reais externos, IA, typing, presença, handoff ou lock.
- TASK-018 não iniciada.
