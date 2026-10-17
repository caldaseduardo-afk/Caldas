# TASK-025 — Cancelamento e remarcação via IA

## Objetivo

Permitir que o `ConversationEngine` conduza cancelamento e remarcação de consultas com estado persistido, identificação inequívoca de Patient e Appointment, confirmação explícita e execução exclusiva pelo `ToolGateway` e pelos services de domínio. Cancelamento preserva a consulta e seu histórico; remarcação mantém a consulta original válida até a confirmação e cria uma nova consulta ligada por `previous_appointment_id`.

## Escopo

- Estender o workflow persistido da TASK-024 com tipo `SCHEDULING`, `CANCELLATION` ou `RESCHEDULING`, consulta alvo e etapas próprias.
- Persistir opções numeradas de Appointments autorizados, separadas das opções de slots.
- Identificar Patient pelo mesmo contexto seguro da TASK-024.
- Listar somente consultas futuras, elegíveis, do Patient ativo e do tenant da conversa.
- Exigir seleção inequívoca da consulta e confirmação contextual antes de cancelar.
- Reutilizar preferência civil, busca de slots, opções persistidas e HOLD para remarcação.
- Manter Patient e Service da consulta original; permitir novo Provider/Unit somente por slot realmente retornado.
- Converter HOLD em nova Appointment e marcar a original `RESCHEDULED` numa única transação.
- Liberar HOLD ao trocar escolha, abandonar ou encerrar remarcação sem confirmação.
- Reconciliar retry/restart, HOLD expirado, cancelamento concluído e remarcação já concluída.
- Preservar contexto no handoff sem executar mutação adicional.

## Fora de escopo

- Troca de Patient ou Service durante remarcação.
- Knowledge Base, resposta clínica, waitlist, pagamento, billing, campanhas, prontuário e Google Calendar completo.
- Cancelamento ou remarcação de consultas em estados não permitidos pela máquina de estados atual.
- TASK-026 e posteriores.

## Decisões técnicas

1. `SchedulingWorkflow` continuará sendo o único framework de workflow. Será acrescentado `workflow_type` e `target_appointment_id`; `appointment_id` continuará representando a Appointment criada como resultado de agendamento/remarcação.
2. `SchedulingAppointmentOption` mapeará `option_number` para Appointment. O modelo será tenant-scoped, terá validade curta e não enviará UUIDs ao usuário como mecanismo de seleção.
3. Cancelamento usará as etapas `IDENTIFY_PATIENT`, `IDENTIFY_APPOINTMENT`, `WAITING_CANCELLATION_CONFIRMATION`, `COMPLETED`, `ABANDONED`, `FAILED`, `NEEDS_HUMAN` e `EXPIRED`.
4. Remarcação usará `IDENTIFY_PATIENT`, `IDENTIFY_APPOINTMENT`, `COLLECT_NEW_PREFERENCES`, `SEARCH_NEW_SLOTS`, `SELECT_NEW_SLOT`, `WAITING_RESCHEDULE_CONFIRMATION` e as etapas terminais comuns.
5. Apenas `PENDING_CONFIRMATION` e `CONFIRMED`, futuras e ainda atuais na cadeia, serão elegíveis ao fluxo automático. `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `NO_SHOW` e `RESCHEDULED` não serão candidatos normais.
6. Uma consulta elegível pode ser apresentada diretamente, mas nunca alterada sem confirmação. Duas ou mais consultas exigem opção persistida; filtros contextuais apenas reduzem a lista e nunca escolhem entre dois resultados equivalentes.
7. Será adicionada a tool estreita `list_appointments`, limitada a um Patient já autorizado, período futuro máximo e quantidade pequena. Tenant e Contact vêm do contexto confiável.
8. `cancel_appointment` e `reschedule_appointment` continuarão bloqueadas para chamadas livres do modelo. O coordenador criará aprovação exata somente na etapa de confirmação correta.
9. A tool de remarcação receberá `appointmentId` e `holdId`. O service de domínio revalidará ambos e fará atomicamente: validar original/HOLD, criar sucessora com Patient e Service originais, consumir HOLD, marcar original como `RESCHEDULED` e auditar.
10. A consulta original permanece inalterada durante busca e HOLD. HOLD vencido ou conflito retorna o workflow à escolha/busca sem alterar a original.
11. O mesmo horário da consulta original será rejeitado antes do HOLD. Provider e Unit podem mudar somente se o slot retornado estiver habilitado para o Service original.
12. Cancelamento repetido do mesmo workflow e remarcação já concluída serão reconciliados pelo estado persistido, pela máquina de estados, pelo ledger de tools e pela cadeia de Appointment.
13. Handoff marca o workflow `NEEDS_HUMAN`; logs contêm IDs, tipo, etapa, resultado e códigos técnicos, sem mensagens ou dados clínicos.

## Arquivos afetados

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261009030000_ai_appointment_changes/migration.sql`
- `apps/api/src/scheduling-workflow/*`
- `apps/api/src/conversation-engine/*`
- `apps/api/src/tools/*`
- `apps/api/src/appointments/*`
- testes unitários e de integração relacionados
- `docs/scheduling.md` e `docs/conversations.md`

## Mudanças de banco

- Adicionar enum de tipo do workflow e novas etapas.
- Adicionar `workflow_type` e `target_appointment_id` ao workflow existente.
- Criar `scheduling_appointment_options` com FKs compostas para tenant, workflow e Appointment.
- Adicionar índices por tenant/tipo/etapa/expiração, consulta alvo e validade das opções.
- Adicionar unicidade que impeça duas sucessoras diretas para a mesma Appointment original.
- Preservar todas as migrations históricas.

## Riscos

- **Consulta ambígua:** opções relacionais numeradas impedem escolha silenciosa ou reconstrução de UUID.
- **Autorização revogada:** contexto, vínculo ContactPatient e target são revalidados em cada tool e dentro da transação.
- **Confirmação duplicada:** etapa terminal, ledger idempotente e constraints de cadeia impedem novo efeito.
- **Remarcação concorrente:** transação serializável e unicidade da sucessora deixam apenas uma cadeia válida.
- **HOLD expira:** a reconciliação remove o HOLD do workflow e mantém a consulta original.
- **Falha após commit:** a reconciliação encontra o status/cadeia final e não repete a mutação.

## Testes

- Identificação de Patient, autorização FULL/SCHEDULING_ONLY, vínculos inválidos e tenant externo.
- Uma e várias consultas elegíveis, seleção numerada, estados inelegíveis e cadeia já remarcada.
- Cancelamento com confirmação, recusa, duplicidade, concorrência, auditoria e recuperação.
- Remarcação completa com busca real, HOLD, preservação da original, confirmação, cadeia, concorrência e recuperação.
- HOLD expirado, mudança/abandono, slot ocupado, Provider/Unit e proibição de troca de Patient/Service.
- Conversation Engine, Tool Gateway, handoff, contexto mínimo, logs e WebSocket já existente.
- E2E de cancelamento com duas consultas e E2E de remarcação com nova Appointment única.

## Critérios de aceite

- Nenhuma consulta é escolhida silenciosamente quando há ambiguidade.
- Nenhuma mutação ocorre sem Patient autorizado, Appointment tenant-scoped e confirmação contextual explícita.
- Cancelamento preserva registro e audita a transição.
- Remarcação mantém a original até o commit e então cria uma sucessora ligada, consome o HOLD e audita atomicamente.
- Retry, concorrência e restart não produzem cancelamentos repetidos nem duas sucessoras.
- Migration, lint, typecheck, testes e build passam.

## Rollback

- Desabilitar o Conversation Engine interrompe novos fluxos sem reverter alterações já confirmadas.
- A migration será aditiva; a versão anterior ignora os campos/tabela novos.
- Remoção posterior exige confirmar ausência de workflows ativos e opções persistidas.

## Comandos de validação

```bash
pnpm --filter @atendente/database db:validate
pnpm db:test
pnpm --filter @atendente/api test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
