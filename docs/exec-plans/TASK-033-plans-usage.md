# TASK-033 — Planos e consumo

## Objetivo
Adicionar planos BASIC, PRO e ENTERPRISE, assinatura por tenant, leitura de
consumo mensal, capabilities efetivas, alertas, enforcement seguro e gestão
administrativa sem cobrança financeira.

## Escopo e decisões
- Catálogo tipado e centralizado em `packages/domain`; não persistir catálogo
  duplicado. Limites e capabilities são conservadores e documentados.
- `TenantSubscription` única por tenant, status separado do status do Tenant,
  ciclo mensal civil UTC (`[currentPeriodStart, currentPeriodEnd)`) e override
  JSON controlado apenas pelo Super Admin.
- Backfill de tenants existentes para BASIC/ACTIVE no período civil UTC atual;
  novas clínicas recebem assinatura na mesma transação de criação.
- Uso calculado nas tabelas-fonte `AIUsage`, `Message`, `Appointment`,
  `UserTenant`, `Unit`, `Provider`, `Integration`, `CalendarIntegration` e
  `KnowledgeArticle`. Isso evita contadores duplicados; evento repetido não
  duplica consumo. Reconciliação é uma nova agregação das fontes, sem ledger
  paralelo nem perda do histórico das fontes.
- Limites operacionais de usuários, unidades, integrações novas e artigos são
  HARD; criação de provider e quotas mensais de IA/mensagens/consultas são
  MEASURE_ONLY ou SOFT_LIMIT. Não bloquear inbound, atendimento/transições de
  conversa, appointment existente, nem criação de appointments por quota.
- BASIC: IA, KB e SLA incluídos; uma unidade; sem Google Calendar, multiunidade,
  analytics avançado ou configuração customizada de IA. PRO inclui capacidades
  premium e limites maiores. ENTERPRISE não tem limites numéricos padrão e
  aceita overrides por tenant. Plataforma continua podendo desabilitar qualquer
  capability centralmente por configuração de código.
- Alertas calculados no servidor em 70%, 85% e 100%; UI consome o mesmo contexto.
  Soft quotas continuam a operação e expõem overage/alerta.
- GRACE/SUSPENDED/CANCELLED preservam dados, inbound, leitura e ações de
  continuidade operacional. Restringir apenas novas capacidades/recursos
  administrativos premium; não cancelar Appointment nem encerrar conversa.
- Upgrade imediato preserva uso/ciclo. Downgrade pode ser agendado para o próximo
  ciclo; se aplicado, excedentes permanecem intactos e bloqueiam apenas novas
  criações hard-limit acima do teto.
- Alterações de plano/override/status apenas por Platform Admin, com audit.
  Clinic Admin pode apenas consultar plano/uso/capabilities do tenant atual.
- Sem Stripe, invoice, cálculo financeiro ou cobrança.

## Arquivos e módulos previstos
- `packages/database/prisma/schema.prisma` e migration aditiva para assinatura,
  enums/audit e índices.
- `packages/domain` para catálogo e funções puras de limite/capability.
- `apps/api/src/plans` para UsageService/PlanPolicy, endpoints tenant-scoped e
  endpoints Super Admin, DTOs e repositories.
- Integração nas criações existentes de unidades, vínculos de usuários,
  integrações e artigos; provisioning de clínica cria assinatura.
- Extensão da projeção Super Admin, contratos em `packages/types`, páginas/UI
  administrativas e proxy web.
- Atualização de `docs/domain-model.md`, `docs/tenancy.md`, documentação de planos
  e testes de domínio, API/DB, concorrência, UI e e2e.

## Mudanças de banco
- `TenantSubscription`: tenant_id único/FK composta, plan_code, status,
  current_period_start/end, grace_until, scheduled_plan_code, overrides JSONB,
  timestamps.
- Índices por status/current_period_end; índice tenant + início de ciclo.
- Novos eventos de auditoria para troca de plano, override e ciclo/grace.
- Não criar usage counters/events: agregações reproduzíveis sobre tabelas-fonte.

## Riscos e mitigação
- Leitura agregada pode crescer em tenants grandes: filtros por tenant/ciclo,
  índices existentes e consultas agregadas por lote; sem carregar histórico todo.
- Concorrência nas cotas hard: transação Serializable com contagem dentro da
  transação; validar conflito serializável e retornar erro de plano consistente.
- Status antigos/sem assinatura: backfill migration e criação transacional.
- Não há integração financeira; status administrativos são definidos pelo
  Super Admin e não inferidos de falha de pagamento.
- Limites iniciais são parâmetros de produto assumidos para o MVP e ficam
  centralizados para ajuste futuro, sem lógica `if(plan)` espalhada.

## Testes e critérios de aceite
- Catálogo: BASIC/PRO/ENTERPRISE, limites, capabilities e overrides isolados.
- Ciclo UTC, upgrade/downgrade, grace e preservação de uso/histórico.
- Uso por fonte: IA tokens/requests, inbound/outbound, consultas e contagens
  instantâneas; idempotência inerente às linhas fonte e reconciliação repetível.
- Hard limit serializado de unidade/usuário; somente uma criação concorrente
  consome a última vaga.
- Soft/measure-only nunca impede webhook/inbound, consulta existente ou transição
  de appointment; nenhuma conversa/appt é apagada/cancelada.
- RBAC: Clinic Admin consulta seu tenant; tentativa de alterar o próprio plano é
  negada; Super Admin altera com auditoria; IDs de outro tenant não vazam.
- UI clínica/Super Admin exibe consumo real, limites, ciclos, alertas e over-limit.
- Lint, typecheck, testes, migration em banco descartável e build passam.

## Rollback
- Reverter os módulos/rotas/UI sem remover dados de uso nem as migrations
  aplicadas. Manter subscriptions e auditoria históricas; remover somente código
  após confirmar ausência de dependências.
- Desabilitar enforcement por configuração da política, sem bloquear operações
  essenciais ou apagar dados.

## Implementação e validação concluídas
- Criados catálogo de domínio, contratos de plano/uso, API tenant-scoped e
  endpoints Super Admin; `TenantSubscription` é criada por trigger transacional
  e tenants existentes são preenchidos na migration.
- Integrados limites rígidos de usuários, unidades, integrações de calendário e
  artigos KB; limites de IA/mensagens/consultas seguem SOFT ou MEASURE_ONLY sem
  interromper operações essenciais.
- A projeção de Super Admin agrega os tenants da página em lote; painel de
  clínica e Super Admin exibem consumo e permitem consulta/alteração conforme
  RBAC. Mensagens são limitadas como total e detalhadas em inbound/outbound.
- Migration testada desde banco vazio e aplicada novamente sem pendências;
  subscriptions seguem exclusão do tenant em exclusões administrativas de teste.
- `pnpm db:test`: migrations do zero e reaplicação, seed repetido, 5 testes de
  integração de database e 302 testes de integração API passaram.
- Testes unitários API: 159 passaram. Web: 23 passaram. `pnpm db:validate`,
  typecheck, lint, suíte unitária completa e build finais passaram após as
  últimas alterações. `git diff --check` também passou.
