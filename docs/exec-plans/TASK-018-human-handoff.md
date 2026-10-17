# TASK-018 — Handoff humano

## Objetivo e escopo

Implementar solicitação, claim exclusivo, transferência, retorno à IA e resolução
humana na Conversation existente, fila NEEDS_HUMAN e controles da Inbox. Preservar
sessão, tenant, RBAC e barramento WebSocket. Não executar TASK-019, SLA, presença,
integrações externas, geração de resumo ou motor de IA.

## Decisões antes da implementação

- Reutilizar transações Serializable e lock de escrita da Conversation. Claim faz
  update condicionado a NEEDS_HUMAN/assignedUserId null após adquirir o lock; retry
  de serialização revalida o estado. Dois atores concorrentes: um sucesso e um 409,
  inclusive em processos distintos. Lock lógico persistido é o responsável, não
  um lock PostgreSQL mantido entre requisições.
- USER exige HUMAN_ACTIVE, responsável igual ao ator autenticado e reply. Não há
  bypass por role: operador com transfer pode transferir explicitamente antes de
  responder. Transfer valida alvo ativo, vínculo/role operacionais e view/contact.view/
  reply no tenant. A permissão transfer existente permite recuperação administrativa
  inclusive se o responsável foi desativado; sem redistribuição automática.
- Solicitar exige reply; assumir exige assign e reply; transferir/devolver exige
  transfer; resolver exige close. Todas também exigem view/contact.view. Retorno e
  resolução exigem responsável atual; transferência explicitamente permite trocar
  responsável de outra pessoa, conforme RBAC existente (AGENT e CLINIC_ADMIN).
- Repetir claim/transfer para responsável atual retorna 409 controlado, sem mudar
  timestamps, auditoria ou publicar eventos. Solicitação repetida também recebe 409.
- Fluxos especiais serão centralizados; status genérico não poderá contornar claim,
  transferência, ownership ou auditoria. AI/WAITING podem solicitar humano;
  NEEDS -> HUMAN; HUMAN -> AI/RESOLVED; transferência mantém HUMAN. HUMAN -> WAITING
  deixa de ser permitido porque removeria o lock sem uma operação explícita.
- canAiRespond retorna true somente em AI_ACTIVE; WAITING_PATIENT não responde
  automaticamente. Persistência interna AI usa a mesma regra sob lock.
- Manter constraints existentes: somente HUMAN tem assignedUserId; somente NEEDS
  tem handoffReason. Claim limpa motivo do registro atual, preservado no audit.
  Retorno/resolução limpam responsável e motivo; audit preserva anterior.
- Adicionar handoffRequestedAt, assignedAt e resolvedAt (UTC timestamptz).
  RequestedAt preservado durante atendimento/resolução, resetado no retorno à IA;
  assignedAt identifica atribuição atual, null fora HUMAN. ResolvedAt é preenchido
  na resolução, preservado ao fechar. Novo ciclo redefine requestedAt. Legado usa
  último audit compatível ou updatedAt como aproximação documentada no backfill.
- Fila é GET /inbox/conversations?status=NEEDS_HUMAN, ordenada requestedAt/id ASC;
  resumo em lote, paciente protegido, uma última mensagem por conversa, paginação.
  Data de solicitação permite calcular espera; sem timer/alerta/SLA.
- Reutilizar conversation.status_changed, conversation.assigned e conversation.updated
  depois do commit; envelopes contêm apenas IDs. Não criar segundo canal/eventos
  redundantes. Eventos de auditoria próprios para as cinco operações.
- Sem SYSTEM message: não há visibility interna no modelo. Sem campo de resumo:
  não existe estrutura anterior, geração continua futura conforme escopo solicitado.

## Sequência e arquivos afetados

1. Schema Prisma/migration nova: timestamps, índice fila, enums audit; revisar SQL.
2. conversations: DTOs, regra de IA, services/repository/controller e testes.
3. inbox: capacidades da sessão, projeções, fila e alvos de transferência paginados.
4. web: controles, composer por ownership, proxy allowlist, fila e testes browser.
5. Ajustar fixtures anteriores que enviavam USER em AI_ACTIVE; documentar contrato.
6. Executar validações, corrigir falhas e registrar resultados/inventário aqui.

## Banco, riscos e rollback

Nova migration somente; preservar migrations aplicadas e FK composta UserTenant.
Índice (tenant_id,status,handoff_requested_at,id); índices de responsável e última
mensagem já existem. Validar constraints de timestamps sem inventar precisão legada.
Riscos: mudança intencional do contrato USER; estado visual pode ficar obsoleto,
mas backend sempre revalida. Barramento segue local a uma instância; claim usa PG
compartilhado. Evento não é outbox durável, reconexão relê REST. Redis não decide lock.
Rollback de aplicação exige manter proteção de ownership; preferir correção adiante.
Migration aditiva pode permanecer ao reverter UI; não remover dados históricos/audit.

## Testes e critérios de aceite

Cobrir estados/motivos, timestamps, concorrência real entre dois atores/instâncias,
409 e ausência de audit/evento em rollback/retry, permissões revogadas, alvo inválido,
usuário desativado, isolamento por ID em todas as operações, invariantes SQL,
AI suspensa, USER exclusivo, fila FIFO/paginação, eventos após commit, duas janelas,
controles e composer refletindo ownership, erro concorrente seguido de releitura.
Nenhuma alteração de TASK-019.

## Comandos de validação previstos

- pnpm db:validate; pnpm db:generate; pnpm db:migrate
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test (migrations do zero/reexecução, integração, concorrência e WebSocket)
- pnpm --filter @atendente/web test:e2e
- pnpm build
- git diff --check

## Resultados

Concluída em 2026-10-03, sem avançar TASK-019.

- `pnpm db:validate`: aprovado.
- `pnpm db:migrate`: migration 20261003000000_human_handoff aplicada no banco local.
- `pnpm db:test`: migrations do zero e reaplicação/seed aprovados; 2 testes do banco
  e 185 testes da API aprovados (inclui concorrência e WebSocket real).
- `pnpm lint`: 8 tarefas aprovadas.
- `pnpm typecheck`: 10 tarefas aprovadas.
- `pnpm test`: 70 testes aprovados (API 50, web 14, banco 3, worker 3).
- `pnpm --filter @atendente/web test:e2e`: 18 testes aprovados após correção do
  seletor no teste de 409. A segunda execução recebeu argumento adicional, mas o
  runner executou novamente os 18 testes, todos aprovados.
- `pnpm build`: 7 tarefas aprovadas.
- `git diff --check`: aprovado.
- Prisma Client gerado pelos scripts de typecheck/test/build; Prettier executado
  nos arquivos trabalhados. Nenhuma dependência nova foi necessária.
- Inspeção visual das capturas de desktop e notebook confirmou os controles e
  layout preservados.

Logs de execução em `/tmp/task018-{lint,typecheck,test,build}.log`,
`/tmp/task018-db-test-final.log`, `/tmp/task018-db-migrate.log` e
`/tmp/task018-e2e-handoff.log`.

Limitações registradas: timestamps legados podem ser aproximados; reassignment de
responsável inativo é manual; barramento continua local à instância e sem outbox.
Essas limitações não afetam a exclusividade do claim, decidida pelo PostgreSQL.
Sem pendências de validação ou integrações externas nesta entrega.

## Inventário da TASK-018

Criados:

- `docs/exec-plans/TASK-018-human-handoff.md`
- `packages/database/prisma/migrations/20261003000000_human_handoff/migration.sql`
- `apps/api/src/conversations/handoff.dto.ts`
- `apps/api/src/conversations/handoff-access.ts`
- `apps/api/test/handoff.test.ts`
- `apps/api/integration/handoff.test.ts`
- `apps/web/components/inbox/handoff-controls.tsx`
- `apps/web/e2e/handoff.spec.ts`

Alterados nesta tarefa (vários já eram trabalho local de etapas anteriores):

- `packages/database/prisma/schema.prisma`
- `apps/api/src/conversations/conversation-access.ts`
- `apps/api/src/conversations/conversation.dto.ts`
- `apps/api/src/conversations/conversation.state.ts`
- `apps/api/src/conversations/conversation.repository.ts`
- `apps/api/src/conversations/conversations.service.ts`
- `apps/api/src/conversations/conversations.controller.ts`
- `apps/api/src/inbox/inbox.repository.ts`
- `apps/api/src/inbox/inbox.service.ts`
- `apps/api/src/inbox/inbox.controller.ts`
- `apps/api/test/conversations.test.ts`
- `apps/api/integration/conversations.test.ts`
- `apps/api/integration/inbox.test.ts`
- `apps/api/integration/realtime.test.ts`
- `apps/web/lib/inbox.ts`
- `apps/web/lib/proxy.ts`
- `apps/web/components/inbox/inbox.tsx`
- `apps/web/components/inbox/conversation-list.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/inbox.spec.ts`
- `apps/web/e2e/realtime.spec.ts`
- `docs/conversations.md`
- `docs/domain-model.md`
- `docs/security.md`

## Cobertura executada

Teste de integração handoff cobre 10 cenários agrupados: pedido/razão/data,
disputa em duas instâncias (200/409, um audit), retry sem alteração, USER exclusivo,
IA suspensa, usuário inativo, todas operações cross-tenant por ID, actor forjado,
transferência/novo e antigo responsável, alvo estrangeiro/inativo/sem permissão,
vínculo revogado, revogação individual de assign/transfer/close/reply, retorno,
resolução/fechamento sem reabertura, fila FIFO/paginação/projeção/alvos, WAITING,
constraints SQL e rollback de auditoria sem evento. Suíte de WebSocket exercita
claim/transfer/return com sockets reais e isolamento A/B. Browser verifica duas
janelas, mudança de ownership/composer, recuperação de 409, transferência, retorno
e resolução, além da regressão de Inbox/realtime.

Regressões encontradas e corrigidas: fixtures antigas enviavam USER em AI_ACTIVE
ou atribuíam por status interno; agora usam handoff explícito. Teste de navegador
refinou seletor de alerta para não confundir com route announcer do Next.
