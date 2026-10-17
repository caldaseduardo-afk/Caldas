# TASK-023 — Conversation Engine

## Objetivo

Implementar o orquestrador assíncrono que processa mensagens inbound já persistidas, monta contexto mínimo e tenant-scoped, chama o `AIProvider`, executa tools exclusivamente pelo `ToolGateway`, persiste a resposta antes de qualquer envio externo e encerra o turno com estado, auditoria e eventos consistentes.

## Escopo

- Criar um registro idempotente de processamento por mensagem inbound.
- Enfileirar o processamento somente após o commit do webhook e recuperar trabalhos pendentes pelo worker.
- Serializar turnos por conversa entre múltiplas instâncias com lease expirável e ordenação pela mensagem inbound.
- Validar `tenantId`, `conversationId` e `messageId` em todas as fronteiras do job.
- Reativar `WAITING_PATIENT` para `AI_ACTIVE` quando uma nova mensagem `PATIENT` for admitida.
- Bloquear respostas automáticas em `HUMAN_ACTIVE`, `NEEDS_HUMAN`, `RESOLVED` e `CLOSED`.
- Montar contexto mínimo com configuração técnica, contato, vínculo ativo de paciente, resumo e histórico recente limitado.
- Usar saída estruturada para intenção, confiança, texto, pedido de handoff e chamadas de tool.
- Executar chamadas permitidas pelo `ToolGateway`, com limite de iterações, quantidade de chamadas e prazo global.
- Persistir intenção, resumo mínimo, resposta da IA, auditoria e eventos na mesma transação final.
- Entregar mensagens externas usando o outbox de mensagens da TASK-020, sem regenerar texto após falha de provider.
- Publicar atualizações em tempo real somente depois do commit por eventos BullMQ validados.
- Solicitar handoff seguro para pergunta clínica, reclamação, pedido explícito de humano, baixa confiança e erro definitivo.

## Fora de escopo

- Fluxo completo de agendamento, remarcação, cancelamento e confirmação da TASK-024.
- Base de conhecimento, configuração completa de IA, Google Calendar, cobrança, campanhas e prontuário clínico.
- Acesso direto do modelo, do provider ou do payload de tool ao banco de dados.
- Priorização complexa ou debounce de mensagens.

## Decisões técnicas

1. `AIProcessingRun` será a fonte de idempotência do turno, com unicidade por `tenant_id + inbound_message_id` e referência opcional à mensagem de resposta.
2. `ConversationEngineLease` terá uma linha por conversa e `expires_at`; aquisição e renovação serão atômicas. O lease expira após crash e não mantém transação de banco aberta durante chamadas externas.
3. Jobs usarão somente UUIDs confiáveis (`tenantId`, `conversationId`, `messageId`, `runId`) e o worker revalidará todas as relações no PostgreSQL antes de processar.
4. A ordem será definida por `Message.createdAt + id`. Um job posterior será adiado enquanto existir run anterior pendente ou em processamento.
5. O webhook criará o run na mesma transação da mensagem. A publicação em BullMQ ocorrerá depois do commit. Um dispatcher periódico reenfileirará runs pendentes, garantindo recuperação quando Redis estiver indisponível.
6. A inferência receberá um grant opaco associado ao run. A camada de aplicação revalidará o run antes de chamar `AIProvider`; nenhum controller aceitará esse grant e nenhum campo arbitrário escolherá outro tenant.
7. O contexto conterá apenas texto necessário e sanitizado. Metadados brutos, documentos, segredos, tokens e dados clínicos não serão enviados. O paciente ativo só será incluído quando o vínculo ativo do contato for válido no mesmo tenant.
8. O histórico terá limite configurável, com teto defensivo. O resumo será curto, administrativo e interno, armazenado em `Conversation`; ele não substituirá os dados transacionais do domínio.
9. A resposta seguirá schema estrito: `intent`, `confidence`, `response`, `waitingForPatient`, `handoffReason`, `summary` e `toolCalls`. Payload inválido será tratado como erro de IA, sem parsing heurístico de texto.
10. As tools continuarão passando pelo `ToolGateway`. O engine receberá um turno interno restrito, derivado do run validado, e somente as capacidades já declaradas para IA serão admitidas. Operações de agendamento completas continuam fora deste escopo.
11. O loop terá limites configurados e com teto: cinco iterações, oito tool calls e 30 segundos por padrão. Estado e autorização serão revalidados antes e depois de cada chamada relevante.
12. A resposta `AI` será criada com `delivery_status = PENDING` quando houver integração/destino WhatsApp válido. Falha no envio altera somente o estado de entrega; o run concluído e o texto persistido não são recriados.
13. `WAITING_PATIENT` será aplicado depois de persistir a resposta quando o modelo indicar que aguarda novo dado. A entrega de mensagem `AI` aceitará tanto `AI_ACTIVE` quanto `WAITING_PATIENT`, pois a mensagem já foi autorizada e persistida antes da transição.
14. Handoff não enviará uma resposta automática depois de a conversa entrar em `NEEDS_HUMAN`. O motivo e um resumo mínimo serão persistidos e o SLA existente será iniciado.
15. Logs terão allowlist técnica: IDs de correlação, tenant, run, resultado, duração, quantidade de tools e código de erro. Conteúdo de mensagem e dados pessoais não serão registrados.
16. O runtime BullMQ fica no módulo de aplicação para reutilizar os serviços request-scoped de autorização, IA e Tool Gateway. Cada job recebe um `ContextId` Nest isolado. A ativação é explícita por `CONVERSATION_ENGINE_ENABLED=true`.

## Arquivos afetados

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261009000000_conversation_engine/migration.sql`
- `packages/database/prisma/migrations/20261009010000_conversation_engine_integrity/migration.sql`
- `packages/database/src/conversation-engine-queue.ts`
- `packages/database/src/messaging-delivery.ts`
- `packages/database/src/index.ts`
- `apps/api/src/conversations/conversation-ingress.service.ts`
- `apps/api/src/conversations/conversation.repository.ts`
- `apps/api/src/conversation-engine/*`
- `apps/api/src/permissions/authorization.service.ts`
- `apps/api/src/tools/tool-gateway.service.ts`
- `apps/api/src/tools/tool.schemas.ts`
- `apps/api/src/app.module.ts`
- `.env.example`
- testes unitários e de integração relacionados

## Mudanças de banco

- Adicionar enums de estado do processamento.
- Adicionar `AIProcessingRun` com chaves compostas tenant-scoped, unicidade por mensagem inbound, índices de dispatch/ordenação e metadados técnicos do turno.
- Adicionar `ConversationEngineLease` com chave única tenant/conversa e índice por expiração.
- Adicionar resumo interno e data de atualização à conversa.
- Relacionar runs a mensagem inbound e, opcionalmente, à mensagem de resposta sem permitir vínculo cross-tenant.
- Adicionar tipos de evento de auditoria do início, conclusão, falha e handoff do engine.

## Riscos e mitigação

- **Duplicação após crash:** unicidade do run, resposta ligada ao run e lease expirável tornam repetição segura.
- **Processamento fora de ordem:** admissão verifica runs anteriores pela ordem persistida da mensagem.
- **Lease perdido durante provider lento:** heartbeat renova o lease até o prazo global; a finalização exige o mesmo owner.
- **Mudança de estado durante tool/inferência:** revalidação no banco interrompe o turno sem emitir mensagem indevida.
- **Redis indisponível:** run permanece pendente no PostgreSQL e dispatcher periódico tenta novamente.
- **Falha após persistir resposta:** outbox usa a mesma mensagem; nunca solicita nova geração.
- **Dados excessivos no prompt:** seleção explícita de campos, sanitização, limite de histórico e testes de ausência de metadados/segredos.
- **Escopo interno excessivo:** grants internos são vinculados a run/conversa/tenant e o gateway mantém allowlist, schemas, limites e auditoria.

## Testes

- Admissão por estado, transição `WAITING_PATIENT -> AI_ACTIVE` e bloqueio nos demais estados.
- Isolamento cross-tenant para job, contexto, mensagem, run, lease e tools.
- Contexto mínimo, limite de histórico, resumo e vínculo ativo de paciente.
- Validação das nove intenções e dos motivos obrigatórios de handoff.
- Loop de tools, múltiplas chamadas, schema inválido, limite, timeout e interrupção após handoff.
- Idempotência do webhook, job duplicado, resposta única, retry controlado e falha de envio.
- Serialização entre workers, ordem A/B/C, paralelismo entre conversas e recuperação de lease expirado.
- Persistência antes de envio/evento, evento pós-commit e ausência de segunda inferência após falha do provider de mensagens.
- Logs e respostas sem segredos, prompts, payloads sensíveis ou detalhes internos.

## Critérios de aceite

- Uma mensagem inbound persistida gera no máximo uma resposta automática persistida.
- Nenhuma resposta é criada para conversa sem autorização de estado ou com IDs inconsistentes.
- Duas instâncias não processam a mesma conversa simultaneamente e mensagens da mesma conversa preservam ordem.
- Conversas distintas podem ser processadas em paralelo.
- O engine usa `AIProvider` e `ToolGateway` sem expor Prisma/SQL ao modelo.
- Handoffs criam estado, motivo, resumo, auditoria e SLA coerentes.
- A mensagem existe antes de envio externo e de atualização realtime.
- Migrations, lint, typecheck, testes e build passam.

## Rollback

- Parar o worker do conversation engine e desabilitar o enqueue/dispatcher preserva mensagens inbound e runs pendentes.
- A migration é aditiva. Em rollback de aplicação, as novas tabelas e colunas podem permanecer sem afetar os fluxos anteriores.
- Remoção física de tabelas/colunas exige migration posterior e só deve ocorrer após confirmar ausência de runs e referências de resposta.

## Comandos de validação

```bash
pnpm --filter @atendente/database db:validate
pnpm --filter @atendente/database db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
