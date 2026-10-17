# TASK-024 — Agendamento via IA

## Objetivo

Implementar o fluxo conversacional completo de agendamento sobre o `ConversationEngine`, mantendo interpretação de linguagem na IA e todas as decisões críticas no backend. O fluxo deve identificar paciente e serviço autorizados, pesquisar disponibilidade real, persistir opções, criar um `AppointmentHold` após escolha inequívoca e converter o HOLD em `Appointment` somente após confirmação explícita.

## Escopo

- Persistir uma sessão de agendamento por conversa, com etapa, seleções, preferências, HOLD, Appointment, expiração e versão para concorrência.
- Persistir as opções numeradas de slot como registros relacionais vinculados à sessão.
- Ampliar a saída estruturada do engine com comandos de workflow; a IA não define etapas críticas diretamente.
- Identificar Patient exclusivamente entre vínculos ativos `VERIFIED` com autorização `FULL` ou `SCHEDULING_ONLY` retornados por `get_contact_context`.
- Validar e selecionar Specialty, Service, Unit e Provider existentes, ativos e pertencentes ao tenant.
- Resolver preferência civil de data e período no timezone da clínica/unidade e pesquisar slots somente por `search_available_slots`.
- Limitar a apresentação a cinco opções e resolver a escolha pelo número persistido.
- Criar, liberar e confirmar HOLD exclusivamente por tools estreitas do `ToolGateway`.
- Reconciliar sessões após retry/restart, HOLD expirado/consumido e Appointment já criado.
- Atualizar `Conversation.intent`, `activePatientId`, status, resumo e mensagens pelo fluxo transacional já existente.
- Preservar o workflow em handoff, sem prolongar o HOLD além de sua expiração normal.

## Fora de escopo

- Cadastro de Patient, Service, Provider ou Unit pela IA.
- Cancelamento ou remarcação completos de Appointment.
- Waitlist, pagamento, orientação clínica, Knowledge Base avançada, Google Calendar, reminders e confirmação automática.
- Cálculo de disponibilidade dentro do engine ou acesso direto da IA/AIProvider ao Prisma.
- TASK-025 e posteriores.

## Decisões técnicas

1. `SchedulingWorkflow` será uma entidade tenant-scoped com relação única a `Conversation`. Uma conversa terá no máximo um workflow atual; reinício de um fluxo terminal limpa suas seleções e incrementa a versão.
2. `SchedulingSlotOption` armazenará `option_number`, Service, Provider, Unit, `start_at`, `end_at`, timezone e validade. A resposta "2" será resolvida por essa linha, nunca reconstruída do texto do modelo.
3. As etapas serão `IDENTIFY_PATIENT`, `IDENTIFY_SERVICE`, `COLLECT_PREFERENCES`, `SEARCH_SLOTS`, `SELECT_SLOT`, `WAITING_CONFIRMATION`, `APPOINTMENT_CREATED`, `COMPLETED`, `ABANDONED`, `FAILED`, `NEEDS_HUMAN` e `EXPIRED`.
4. A saída da IA receberá um comando opcional e estrito (`START`, `SELECT_PATIENT`, `SELECT_SERVICE`, `SET_PREFERENCES`, `SEARCH_SLOTS`, `SELECT_SLOT`, `CONFIRM`, `CHANGE_SELECTION`, `ABANDON`, `NONE`). O backend rejeitará transições incompatíveis com a etapa atual.
5. Patient e recursos de catálogo serão aceitos somente após consulta tenant-scoped no backend. Selecionar Patient também atualiza `Conversation.activePatientId`, para que o contexto confiável do Tool Gateway seja coerente.
6. `DECLARED`, `REVOKED`, `NO_ACCESS`, vínculo inativo e recursos cross-tenant permanecem invisíveis/inválidos; nenhum deles será promovido ou criado pelo fluxo.
7. Datas preferidas serão civis `YYYY-MM-DD`. Períodos usarão uma utility única: `MORNING` 06:00–12:00, `AFTERNOON` 12:00–18:00, `EVENING` 18:00–22:00 e `ANY` 00:00–24:00. A conversão para instantes usa o timezone efetivo da unidade/clínica e rejeita datas passadas ou horários locais inválidos.
8. O engine não calcula slots. O coordenador monta argumentos autorizados e chama `search_available_slots`; Service duration override, buffers, regras, exceções, Appointments e HOLDs continuam sendo aplicados por `SchedulingService`.
9. A busca persistirá no máximo cinco opções. Ausência de resultado mantém a sessão em coleta/busca e pede nova preferência, sem ampliar unidade/provider silenciosamente.
10. `create_hold` será liberada ao engine somente pelo coordenador, que usa a opção persistida e um `callId` determinístico por sessão/versão/opção. O service de HOLD revalida agenda e concorrência na transação existente.
11. Uma nova tool estreita `release_hold` chamará `HoldsService.release`; mudanças de Patient, Service, Unit, Provider, slot ou abandono liberarão o HOLD ativo antes de limpar o estado.
12. `confirm_appointment` receberá aprovação exata no `ToolTurn` apenas quando a etapa for `WAITING_CONFIRMATION` e o comando estruturado for `CONFIRM`. A conversão existente cria `PENDING_CONFIRMATION`, origem `WHATSAPP_AI`, consome o HOLD e permanece serializável/idempotente.
13. Etapas críticas serão derivadas dos resultados das tools: somente `create_hold` bem-sucedida produz `WAITING_CONFIRMATION`, e somente `confirm_appointment` bem-sucedida produz `APPOINTMENT_CREATED/COMPLETED`.
14. Cada mutação do workflow usa versão otimista e revalida o lease/run da conversa. O lease da TASK-023 serializa mensagens; constraints, ToolExecution e transações de HOLD/Appointment protegem retries e concorrência externa.
15. A expiração do workflow será configurável, com padrão de 24 horas. O acesso seguinte reconcilia e marca sessões vencidas; HOLDs mantêm seu TTL independente e o worker existente continua sendo a fonte de expiração da reserva.
16. Após crash, a sessão é reconciliada com o HOLD/Appointment. HOLD ainda ativo retorna à confirmação; HOLD vencido/liberado retorna à seleção; HOLD consumido com Appointment vinculada conclui sem recriar.
17. Handoff marca a sessão `NEEDS_HUMAN` e preserva escolhas/resumo. HOLD ativo não é renovado e expira pelo TTL normal.
18. Logs e auditoria registrarão apenas IDs, etapa, resultado, duração e códigos técnicos. Mensagens, nomes e dados clínicos não serão copiados para logs.

## Arquivos afetados

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261009020000_ai_scheduling/migration.sql`
- `apps/api/src/scheduling-workflow/*`
- `apps/api/src/conversation-engine/*`
- `apps/api/src/tools/tool.schemas.ts`
- `apps/api/src/tools/tool-gateway.service.ts`
- `apps/api/src/tools/tool.handlers.ts`
- `apps/api/src/permissions/authorization.service.ts`
- `apps/api/src/appointments/appointment.repository.ts`
- `apps/api/src/app.module.ts`
- `.env.example`
- testes unitários e de integração relacionados
- `docs/conversations.md` e `docs/scheduling.md` para registrar as decisões implementadas

## Mudanças de banco

- Adicionar enums de etapa e período do workflow.
- Adicionar `scheduling_workflows` com FKs compostas tenant-scoped para Conversation, Contact, Patient, Specialty, Service, Provider, Unit, HOLD e Appointment.
- Adicionar `scheduling_slot_options` com FKs compostas tenant-scoped e unicidade de número por workflow.
- Adicionar índices por tenant/conversa/etapa/expiração, Patient, Service, Provider/Unit e validade das opções.
- Adicionar constraints de coerência temporal, opção positiva, relação conversa/tenant e referências cross-tenant impossíveis.

## Riscos e mitigação

- **IA tenta pular etapas:** comandos são validados contra a etapa; estados críticos só mudam com retorno real de tool.
- **UUID inventado ou cross-tenant:** seleção consulta recurso ativo e vínculo autorizado no tenant antes de persistir.
- **Opção desatualizada:** `create_hold` usa a opção persistida, mas sempre revalida toda a agenda no service de HOLD.
- **Confirmação duplicada:** ToolExecution idempotente, HOLD único/consumido, Appointment único por HOLD e sessão vinculada à Appointment impedem duplicação.
- **Crash entre ação e estado:** reconciliação consulta HOLD/Appointment e restaura a etapa sem repetir a ação concluída.
- **Mudança de escolha deixa reserva:** o coordenador libera o HOLD via Tool Gateway antes de invalidar seleções.
- **Timezone/DST:** preferência é data civil e a conversão usa timezone IANA efetivo; instantes absolutos continuam em UTC com offset explícito.
- **Handoff com HOLD:** o estado fica disponível ao humano, mas a reserva não é renovada e mantém o TTL curto existente.

## Testes

- Identificação SELF, múltiplos dependentes, autorizações, vínculo revogado/inativo e isolamento cross-tenant.
- Seleção/ambiguidade de Specialty e Service; recurso inativo ou inventado.
- Data/período/timezone, busca real, limite, sem resultados e ausência de cálculo de slot no engine.
- Mapeamento persistido, escolha clara/ambígua, revalidação, conflito concorrente e troca de seleção.
- Criação/liberação/expiração de HOLD, confirmação contextual, conversão, origem, dados finais e duplicatas.
- Retomada após crash, HOLD expirado, Appointment já criada e timeout de workflow.
- Estados de Conversation, mensagens, handoff, segurança do prompt/log e eventos WebSocket existentes.
- Um cenário integrado completo da primeira mensagem à Appointment única.

## Critérios de aceite

- O fluxo sobrevive a várias mensagens e restart sem depender da memória textual do LLM.
- Nenhum Appointment é criado sem Patient autorizado, slot real, HOLD válido e confirmação explícita contextual.
- Toda busca/reserva/liberação/conversão passa pelo Tool Gateway e pelos services de domínio.
- Mensagem duplicada, job duplicado e confirmação duplicada não criam HOLD ou Appointment adicionais.
- IDs cross-tenant/inventados não revelam existência nem alteram estado.
- Conversation, workflow, HOLD, Appointment, mensagens, auditoria e realtime permanecem coerentes.
- Migration, lint, typecheck, testes e build passam.

## Rollback

- Desabilitar `CONVERSATION_ENGINE_ENABLED` interrompe novos turnos sem afetar HOLDs/Appointments já persistidos.
- A migration é aditiva; a aplicação anterior ignora as tabelas novas e continua com o engine da TASK-023.
- A remoção das tabelas/enums exige migration posterior e somente após confirmar ausência de workflows ativos.

## Comandos de validação

```bash
pnpm --filter @atendente/database db:validate
pnpm --filter @atendente/database db:migrate
pnpm --filter @atendente/api test
pnpm --filter @atendente/api test:integration
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm build
```
