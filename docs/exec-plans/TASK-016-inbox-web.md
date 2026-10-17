# TASK-016 — Inbox Web

## Objetivo e escopo

Entregar central de conversas real em /conversations com lista, histórico e contexto,
busca e paginação no servidor, paciente ativo e composição local. Apenas TASK-016.
Não implementar tempo real, handoff, IA ou envio externo. Não simular não lidas:
não existe estado de leitura por operador no backend atual.

## Decisões e arquivos previstos

- React/Next existentes, fetch e estado local, sem biblioteca adicional de estado.
- URL ?conversationId=UUID preserva seleção no refresh. Tenant vem da sessão;
  seleção explícita usa endpoint de tenancy existente, nunca query de tenant.
- Proxy Next restrito a rotas utilizadas: cookie HttpOnly e Origin encaminhados,
  sem tokens no JavaScript, sem cache; API_INTERNAL_URL somente no servidor.
- Login e seleção de clínica mínimos reutilizam autenticação existente.
- Módulo backend inbox com projections sanitizadas para evitar requests por item.
  Guards, services e queries revalidam tenant e permissões existentes. Capabilities
  informam a UI; não substituem autorização do backend. Dados de pacientes e
  consultas somente com permissões correspondentes, inclusive busca por paciente.
- Lista paginada por página (20), ordenada lastMessageAt desc, createdAt/id como
  desempate. Busca nome/telefone/paciente ativo no banco, antes da paginação.
- Histórico recente por cursor de mensagem, ordem descendente na consulta e
  crescente na resposta. Botão para anteriores; nenhum carregamento ilimitado.
- AbortController e descarte de respostas obsoletas; seleção limpa dados anteriores.
- Mensagens como texto React escapado; metadados não viram URLs. Tipos não-texto
  têm fallback. Composer persiste USER pelo endpoint existente, com aviso explícito
  de que não envia ao WhatsApp. Seleção de paciente usa PATCH existente.
- Datas de mensagens no timezone do tenant; consulta na timezone efetiva da unidade.
- Arquivos: apps/api/src/inbox, registro no AppModule, testes de integração;
  apps/web/app, componentes/lib/test de inbox, configuração do proxy e documentação.

## Banco

Sem mudanças de domínio ou migrations previstas. Reutilizar relações e índices
existentes. Projections não expõem tenantId, tokens, documentos, notas clínicas
ou identificadores internos de providers de mensagens.

## Riscos e limites

Paginação por offset da lista pode mudar com novas mensagens; atualização manual.
Sem unread real, realtime, anexos binários ou entrega externa. Permissões revogadas
são revalidadas a cada request. Troca de tenant descarta seleção e respostas antigas.

## Testes e critérios de aceite

Cobrir acesso/403/404 cross-tenant, filtros, busca antes da paginação, projections
por permissão, paciente/consulta, ordem e cursor. Frontend: autores e tipos,
conteúdo hostil, estados vazios/loading/erro, composição local, URL e respostas
obsoletas. Verificar layout desktop e painel recolhível. Testes existentes de
escrita de paciente e mensagens continuam obrigatórios. Nenhuma TASK-017.

## Comandos de validação

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test
- pnpm --filter @atendente/web test
- pnpm build
- git diff --check

## Rollback

Remover rota/componentes/proxy e módulo inbox, restaurar landing page e configuração
web. Nenhuma alteração destrutiva no banco ou nos endpoints da TASK-015.

## Entrega e inventário

Criados:

- `apps/api/src/inbox/inbox.controller.ts`
- `apps/api/src/inbox/inbox.dto.ts`
- `apps/api/src/inbox/inbox.module.ts`
- `apps/api/src/inbox/inbox.repository.ts`
- `apps/api/src/inbox/inbox.service.ts`
- `apps/api/integration/inbox.test.ts`
- `apps/api/test/inbox.test.ts`
- `apps/web/app/conversations/page.tsx`
- `apps/web/app/api/[...path]/route.ts`
- `apps/web/app/globals.css`
- `apps/web/components/inbox/inbox.tsx`
- `apps/web/components/inbox/conversation-list.tsx`
- `apps/web/components/inbox/messages.tsx`
- `apps/web/components/inbox/context-panel.tsx`
- `apps/web/lib/inbox.ts`
- `apps/web/lib/use-remote.ts`
- `apps/web/lib/proxy.ts`
- `apps/web/test/inbox.test.tsx`
- `apps/web/test/proxy.test.tsx`
- `apps/web/e2e/inbox.spec.ts`
- `apps/web/playwright.config.ts`
- Este plano.
- `apps/web/AGENTS.md` e `apps/web/CLAUDE.md`: gerados automaticamente pelo
  Next 16.3.8 ao iniciar desenvolvimento; instruções e guias locais consultados.

Alterados nesta tarefa:

- `apps/api/src/app.module.ts`: registro do módulo Inbox.
- `apps/web/app/layout.tsx`: estilos globais.
- `apps/web/app/page.tsx`: entrada para a inbox.
- `apps/web/package.json`, `pnpm-lock.yaml`: Playwright somente desenvolvimento e
  script test:e2e. Sem biblioteca nova de estado de produção.
- `apps/web/test/page.test.tsx`: valida a entrada atual.
- `.env.example`, `compose.yaml`: URL interna do proxy.
- `.gitignore`: artefatos locais Playwright.
- `README.md`, `docs/conversations.md`: configuração, contratos e limitações.

Componentes: Inbox (login/sessão/seleção de clínica), Workspace, ActiveConversation
(cabeçalho), ConversationList (busca/filtros/lista/paginação), MessageList,
MessageBubble, MessageComposer e ContextPanel (inclui seleção de paciente).

Rotas públicas de UI: `/`, `/conversations?conversationId=UUID`. A página estática
contém apenas shell; dados requerem autenticação. `/api/[...path]` é proxy de
allowlist fixa, não aceita destino externo. Endpoints novos: GET /inbox/session,
GET /inbox/conversations, GET /inbox/conversations/:id e
GET /inbox/conversations/:id/messages. Escritas permanecem nos endpoints existentes.

## Validação executada — 2026-10-02

- `pnpm lint`: aprovado, 8 tarefas.
- `pnpm typecheck`: aprovado, 10 tarefas.
- `pnpm test`: aprovado, 62 testes (API 47, banco 3, worker 3, web 9).
- `pnpm --filter @atendente/web test`: aprovado, 9 testes.
- `pnpm db:test`: aprovado, 152 testes API + 2 banco; migrations históricas
  aplicadas do zero e reaplicadas, seed reexecutado em PostgreSQL isolado.
- `pnpm --filter @atendente/web test:e2e`: aprovado, 12 testes Chromium.
- `pnpm build`: aprovado, 7 tarefas; /conversations e proxy presentes no build.
- `git diff --check`: aprovado.
- Prettier aplicado somente aos arquivos trabalhados e documentação relacionada.
- `pnpm --filter @atendente/web add -D @playwright/test` e
  `pnpm --filter @atendente/web exec playwright install chromium`: executados.

Primeiras verificações revelaram erros de tipos nos fixtures, corrigidos; também
houve concorrência entre geração Prisma de test/typecheck e download inicial do
Chromium ainda em andamento. Verificações finais foram executadas sequencialmente
onde compartilham artefatos. Dois seletores de testes de navegador foram corrigidos
(texto incidental de outro contato e alerta de navegação do Next).

Sem migration nova, alteração de schema, enums ou concessões de permissão.

### Cobertura dos cenários solicitados

- 1–9, 17–19, 23, 24, 25, 37: integração HTTP com PostgreSQL, filtros, busca,
  paginação, 401/403/404, vínculos, próxima consulta e revogação de permissões.
- 10–16, 20, 26–30, 33–36, 38–40: navegador Chromium e renderização, seleção,
  refresh, race A→B, autores, tipos, contexto, datas, layout e conteúdo hostil.
- 21–22: navegador testa seleção via PATCH; suíte real da TASK-015 reexecutada
  valida vínculo autorizado, paciente estrangeiro/sem vínculo e permissões.
- 31–32: integração real bloqueia reply revogado; navegador/unitários verificam
  composer desabilitado e aviso explícito de registro local, sem entrega externa.
- Proxy: Origin preservado inclusive não confiável/ausente, cookie HttpOnly,
  allowlist, payload limitado a 8 KiB durante leitura, erros sem detalhes internos.

Screenshots revisadas: `/tmp/task016-inbox-desktop.png` (1440×900) e
`/tmp/task016-inbox-notebook.png` (1024×768), com fixtures exclusivos dos testes.
Produção não recebe mocks. Testes de navegador interceptam HTTP; segurança e
persistência são verificadas separadamente na integração PostgreSQL real.

## Limites finais

- Atualização manual e paginação por offset da lista podem mover itens entre páginas
  após atividade concorrente. Histórico usa cursor estável createdAt + id.
- Até 100 vínculos ativos no contexto (ordem estável); sem prontuário ou histórico
  completo de vínculos. Paciente ativo é consultado separadamente.
- Nenhum indicador fictício de não lidas; não há suporte por operador no modelo.
- Sem entrega WhatsApp, downloads, uploads, IA, WebSocket, locks ou handoff completo.
- Cancelar fetch de escrita não desfaz uma gravação já confirmada no servidor; em
  falha de confirmação o composer orienta atualizar antes de repetir.
- Proxy preserva a política existente de autenticação/CSRF. Como as conexões chegam
  à API pelo servidor web, o limitador por IP é agregado nesse salto; implantação
  futura com identificação do cliente exige política explícita de proxy confiável.
- Nenhuma funcionalidade da TASK-017 foi iniciada.
