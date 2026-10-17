# TASK-030 — Auditoria completa

## Objetivo e escopo

Consolidar auditoria de negócio transacional, sanitizada e consultável por tenant,
sem iniciar TASK-031. Preservar a tabela e o histórico existentes `auth_events`:
`AuthEvent` passa a ser o modelo físico compatível do AuditLog. Identidade global
(login/logout/criação de identidade sem clínica) permanece exceção explícita com
tenant nullable; novos eventos de negócio exigem tenant. Não fabricar tenant ou ator.

## Plano

1. Inventariar writers existentes e ações tipadas; separar eventos técnicos.
2. Evoluir schema com actorType, source, resourceType, actorReferenceId,
   previousValues/newValues/metadata/correlationId e marcador de evento de negócio.
   Migration aditiva preserva registros antigos; não inferir autoria humana inexistente.
3. Criar helper explícito compartilhado de escrita e sanitização recursiva; adaptar
   writers de domínio conservando a transação. Contexto confiável de execução propaga
   ator/correlação da tool; worker e integração usam origem explícita.
4. Criar API somente leitura com audit.view, filtros estritos, paginação limitada,
   ordem createdAt/id DESC e filtro de autorização dentro da query.
5. Criar tela administrativa mínima com JSON escapado e autorização no backend.
6. Testar sanitização, atores, transações, isolamento, paginação e fluxos críticos.
7. Documentar matriz, limites e resultados; executar validações completas.

## Decisões técnicas

- Reutilizar AuthEventType como catálogo tipado de ações e auth_events como histórico
  único; nomes físicos compatíveis evitam duplicação e perda de dados.
- Campos estruturais novos distinguem AuditLog de histórico técnico legado. Não
  migrar logs técnicos para a consulta administrativa como se fossem ações humanas.
- Append-only na API/repository: nenhuma operação pública de alteração/exclusão.
  FKs Restrict preservam histórico; sem trigger que bloqueie administração/migrations.
- Snapshots mínimos aproveitam before/after explícitos dos serviços; sanitização é
  defesa adicional, não autorização para copiar entidades, prompts ou argumentos.
- Tenant representa o recurso. SUPER_ADMIN mantém bloqueio atual até MFA/plataforma.
- Retenção sem limpeza automática; política de retenção futura exige decisão explícita.
- Administração de usuários/roles ainda sem CRUD completo não será criada nesta task;
  cobrir os pontos de provisionamento existentes e documentar essa fronteira.

## Arquivos e banco

packages/database: schema, nova migration, helper audit, writers de automação e testes.
apps/api: writers de domínio, contexto de tools, módulo audit e testes.
apps/web: tela/proxy/testes de auditoria. docs: matriz e decisões de segurança.
Índices tenant/data, tenant/recurso, tenant/ação, tenant/ator e correlação.

## Riscos e rollback

Histórico antigo não contém toda a proveniência: manter source SYSTEM quando não
comprovável, sem inventar autoria. Adaptar escritores sem perder atomicidade ou
alterar regras de negócio. Rollback de aplicação mantém colunas aditivas e registros;
não apagar histórico nem reverter migration destrutivamente.

## Testes e critérios de aceite

Auditoria USER/AI/AUTOMATION, sanitização aninhada, isolamento por ID/filtros,
403 sem audit.view, snapshots de status, rollback de mutação/auditoria, paginação,
correlação e ausência de endpoints de escrita. Fluxos humano, IA e worker cobertos
com infraestrutura local e providers fake; nenhuma chamada externa necessária.

## Comandos de validação

- pnpm db:validate
- pnpm db:migrate
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm db:test
- pnpm build
- git diff --check

## Inventário da implementação

Criados: helper compartilhado `packages/database/src/audit.ts`; módulo `apps/api/src/audit/`
(controller, query service, DTO, contexto/interceptor e module); tela
`apps/web/app/settings/audit/page.tsx` e componente `audit-settings.tsx`; testes unitários
e de integração `audit.test.ts` na API e `audit.test.tsx` no frontend; `docs/audit.md`.

Migrations novas: `20261013000000_complete_audit` e
`20261014000000_audit_workflow_classification`. A segunda preserva eventos técnicos
de workflow sem duplicar o handoff de Conversation na listagem de negócio.

Arquivos existentes adaptados para escrita central (sem reimplementar suas regras):

- `apps/api/src/ai-configuration/ai-configuration.repository.ts`
- `apps/api/src/appointments/appointment.repository.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/create-user.ts`
- `apps/api/src/availability/availability-rule.repository.ts`
- `apps/api/src/availability/schedule-exception.repository.ts`
- `apps/api/src/calendar-integrations/calendar-integrations.repository.ts`
- `apps/api/src/catalog/service.repository.ts`
- `apps/api/src/catalog/specialty.repository.ts`
- `apps/api/src/clinics/clinic.repository.ts`
- `apps/api/src/clinics/development-provisioning.ts`
- `apps/api/src/contacts/contact-channel.repository.ts`
- `apps/api/src/contacts/contact.repository.ts`
- `apps/api/src/conversation-engine/conversation-engine.repository.ts`
- `apps/api/src/conversations/conversation-create.ts`
- `apps/api/src/conversations/conversation-ingress.service.ts`
- `apps/api/src/conversations/conversation.repository.ts`
- `apps/api/src/holds/hold.repository.ts`
- `apps/api/src/human-sla/human-sla.repository.ts`
- `apps/api/src/knowledge/knowledge.repository.ts`
- `apps/api/src/notifications/notification.repository.ts`
- `apps/api/src/patients/patient.repository.ts`
- `apps/api/src/patients/relationship.repository.ts`
- `apps/api/src/providers/provider-service.repository.ts`
- `apps/api/src/providers/provider-unit.repository.ts`
- `apps/api/src/providers/provider.repository.ts`
- `apps/api/src/scheduling-workflow/scheduling-workflow.repository.ts`
- `apps/api/src/tenancy/grant-membership.ts`
- `apps/api/src/tenancy/tenant.repository.ts`
- `apps/api/src/units/unit.repository.ts`
- `packages/database/src/calendar-sync.ts`
- `packages/database/src/configure-whatsapp.ts`
- `packages/database/src/hold-expiration.ts`
- `packages/database/src/human-sla.ts`
- `packages/database/src/messaging-delivery.ts`
- `packages/database/src/notification-automation.ts`

Também alterados: schema Prisma; exports e catálogo RBAC do database; AppModule;
AuthorizationService; ToolGateway; proxy e navegação web; testes de catálogo RBAC,
appointments, handoff, worker-automations e ai-appointment-changes; documentação de
arquitetura, segurança e domínio.

## Limitações registradas

- Sem CRUD novo de identidade/papéis/permissões: cobre provisionamento existente e
  mantém o seed como operação técnica. Não criar funcionalidades da TASK-032.
- Nome de ator é mostrado por ID estável, sem copiar nome pessoal para histórico.
- Não reconstruir ator/origem de eventos anteriores sem evidência.
- Apenas aplicação append-only; acesso administrativo SQL continua disponível.
- Validações que regeneram Prisma Client executadas sequencialmente para evitar
  corrida na pasta gerada compartilhada.

## Validação final — 2026-10-15

- `pnpm db:migrate`: migrations aplicadas; `pnpm db:test`: criação do banco de
  teste do zero, reaplicação e seed aprovados, 5 testes do database e 284 testes de
  integração da API aprovados, sem falhas.
- Três cenários end-to-end aprovados: cancelamento humano (USER/WEB), cancelamento
  pela IA (AI/AI_ENGINE) e handoff por ausência de resposta (AUTOMATION/WORKER).
  Incluem ator, tenant, correlação, snapshots e ausência de duplicação.
- `pnpm lint`: 8 tarefas aprovadas.
- `pnpm typecheck`: 11 tarefas aprovadas, incluindo dependências.
- `pnpm test`: 146 testes da API, 19 do frontend, 6 do worker e 6 do database
  aprovados. Inclui sanitização, autorização, contexto de ator e renderização segura.
- `pnpm build`: 7 tarefas aprovadas; rota `/settings/audit` gerada com sucesso.
- `pnpm db:validate`: schema Prisma válido.
- `git diff --check`: aprovado.

As integrações cobrem isolamento cross-tenant, filtros/paginação, 403/404, histórico
preservado e rollback transacional. O frontend foi validado por testes de renderização
SSR/proxy e build; não foi executado teste visual em navegador. Aviso de depreciação
do driver `pg` durante integração não impediu os testes. TASK-031 não iniciada.
