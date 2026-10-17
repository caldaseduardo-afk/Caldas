# TASK-027 — Configuração e versionamento da IA

## Objetivo

Adicionar configuração versionada da IA por tenant, com uma única versão ativa em produção, simulação segura de drafts e composição central do prompt. A versão usada por cada processamento será persistida para rastreabilidade, sem permitir que configuração do tenant reduza as regras fixas da plataforma ou amplie tools/capabilities.

## Escopo

- Criar `AIConfiguration` por tenant e `AIConfigurationVersion` com histórico linear.
- Suportar `DRAFT`, `PUBLISHED` e `ARCHIVED`, criação baseada na versão ativa, publicação explícita, restauração por cópia e optimistic locking.
- Configurar nome, tom, saudação, instruções administrativas limitadas, tópicos permitidos, handoff estruturado, Knowledge Base, modelo e parâmetros seguros.
- Adicionar `settings.view` e `ai_config.publish`, mantendo `settings.manage` para edição.
- Centralizar a hierarquia em `AIPromptComposer`: plataforma, configuração tenant, Knowledge Context e conversa.
- Filtrar tools e ações do Conversation Engine por interseção entre capabilities da plataforma e as habilitadas pelo tenant.
- Registrar `ai_configuration_version_id` em `AIProcessingRun` e `AIUsage`.
- Implementar simulação de draft sem Tool Gateway mutável: tools operacionais recebem apenas resultados mock; somente retrieval publicado da KB pode ser executado como leitura.
- Criar API administrativa, comparação básica e tela mínima em `/settings/ai`.
- Testar versionamento, concorrência, RBAC, isolamento, prompt, engine, simulação, restauração e frontend.

## Fora de escopo

- Workers, reminders e automações da TASK-028.
- Provider configurável por tenant, API keys em banco/UI, criação livre de tools ou marketplace de prompts.
- Editor visual de workflows, simulação com efeitos reais, draft conjunto da KB ou cache distribuído.
- TASK-028 e posteriores.

## Decisões técnicas

1. `AIConfiguration` será única por tenant e guardará `active_version_id`. `AIConfigurationVersion` guardará conteúdo, status, número sequencial, autoria e `based_on_version_id`.
2. Publicar executará em transação Serializable: trava lógica da configuração, arquiva a ativa anterior, publica o draft e atualiza `active_version_id`. Índices únicos impedem dois números iguais e mais de um draft.
3. Restauração será uma ação explícita de publicação: cria a próxima versão copiando a escolhida, define `based_on_version_id`, arquiva a ativa e publica a cópia na mesma transação. O registro antigo nunca é reativado ou alterado.
4. O número da versão será calculado dentro de transação Serializable e protegido por unicidade `(tenant_id, configuration_id, version_number)` com retry limitado para conflito serializável.
5. Edição só aceitará draft e exigirá `expectedUpdatedAt`. Versões publicadas/arquivadas são imutáveis.
6. Regras obrigatórias de handoff (`USER_REQUESTED_HUMAN`, `CLINICAL_QUESTION` e `COMPLAINT`) permanecem fixas. Negociação de pagamento, miss de conhecimento e limiar de confiança serão configuráveis dentro de limites seguros.
7. Capabilities serão enums estruturados: scheduling, rescheduling, cancellation, knowledge e handoff. `effectiveCapabilities = platformCapabilities ∩ tenantCapabilities`. Ausência de configuração usa todas as capabilities seguras atuais da plataforma.
8. Modelos permitidos virão de `OPENAI_ALLOWED_MODELS`; o modelo global `OPENAI_MODEL` sempre integra a lista. Model, temperature (0–2), max output tokens (64–4096) e confidence (0–1) serão validados antes de salvar/publicar.
9. A configuração nunca conterá provider ou credencial. Padrões óbvios de segredo e instruções incompatíveis (`execute SQL`, ignorar tenant/autorização/handoff clínico) serão rejeitados; as barreiras reais continuam no engine, RBAC e Tool Gateway.
10. `AIPromptComposer` manterá regras fixas no primeiro bloco, configuração do tenant em bloco identificado de autoridade inferior e dados/conversa fora desse texto. KB continua como contexto delimitado da TASK-026.
11. O fluxo real carrega somente `active_version_id` em cada novo run. Publicação no meio de uma conversa afeta apenas o próximo processamento; cada run registra a versão usada.
12. Sem versão publicada, o engine usa fallback seguro em memória: nome genérico, tom profissional, regras obrigatórias e configuração global de modelo. Draft nunca é fallback de produção.
13. Não haverá cache de configuração nesta entrega: cada run lê apenas a versão ativa indexada. Isso evita invalidação cross-process inconsistente no MVP; a interface de acesso permite cache tenant/version-aware posterior.
14. Simulação usa a versão draft indicada e o AIProvider real configurado, mas não abre turno nem executa Tool Gateway. Pode realizar somente `search_knowledge_base`; demais tool calls são apenas relatadas como propostas não executadas. Retorna resposta, intenção, calls propostas, handoff, KB usada, usage, latência e version ID.
15. A tela administrativa será simples e coerente com o frontend atual: status/versão ativa, formulário do draft, simulação, publicação e histórico/restauração, sem editor visual.

## Arquivos afetados

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261009050000_ai_configuration_versioning/migration.sql`
- `packages/database/src/rbac-catalog.ts` e testes do catálogo
- `apps/api/src/ai-configuration/*`
- `apps/api/src/ai/*`
- `apps/api/src/conversation-engine/*`
- `apps/api/src/tools/tool-gateway.service.ts`
- `apps/api/src/app.module.ts`
- testes unitários e de integração
- `apps/web/app/settings/ai/*`, `apps/web/lib/proxy.ts`, estilos e testes
- documentação de arquitetura, domínio, segurança, conversas e integrações

## Mudanças de banco

- Enums de status, tom e capabilities.
- Tabelas `ai_configurations` e `ai_configuration_versions` com tenant obrigatório, FKs compostas, autoria e timestamps.
- `active_version_id` com FK composta para a própria configuração/tenant.
- `ai_configuration_version_id` opcional em `ai_processing_runs` e `ai_usage` para suportar fallback legado/seguro.
- Índices por tenant, status, versão, publicação, base e versão ativa; índices parciais para um draft.
- Eventos de auditoria e permissões adicionais.

## Riscos

- **Configuração maliciosa:** validação preventiva e limites estruturais; tools, tenant e handoff obrigatório continuam controlados por código.
- **Publicação concorrente:** Serializable, unicidade e atualização atômica do ponteiro ativo.
- **Modelo incompatível:** allowlist do ambiente e parâmetros limitados; suporte efetivo de temperature ainda depende do modelo selecionado.
- **Simulação com custo:** usa provider real e gera AIUsage, mas sem efeitos de domínio. Falha de provider é segura e nenhuma versão é publicada.
- **Múltiplas instâncias:** não usar cache evita configuração obsoleta; custo é uma leitura indexada por processamento.
- **Frontend inicial:** tela administrativa será funcional e compacta, sem CMS/editor de workflow.

## Testes

- DTOs, limites, allowlist de modelo, segredo e padrões perigosos.
- Primeira versão, draft derivado, publicação, histórico, restore, optimistic locking e concorrência.
- RBAC, autoria/auditoria, IDs e leitura/escrita cross-tenant.
- Composer, ordem de autoridade, fallback seguro e interseção de capabilities.
- Engine usa somente ativa, registra versão no run/usage e adota nova publicação no próximo run.
- Simulação mostra tool calls sem executar mutações, usa apenas KB publicada e permanece tenant-scoped.
- Frontend: renderização segura, estados visuais, confirmação de publicação e proxy restrito.
- E2E obrigatório Clara v1 → simulação → publicação → v2 draft invisível em produção → publicação → restauração como nova versão.

## Critérios de aceite

- Exatamente uma versão ativa por tenant, com histórico preservado.
- Produção nunca usa draft e cada run fica associado à versão efetiva quando existente.
- Tenant config não reduz segurança nem amplia capabilities da plataforma.
- Simulação não altera agenda, paciente, conversa, HOLD ou WhatsApp.
- Ausência de configuração mantém prompt seguro e não vazio.
- Migration, lint, typecheck, testes, integrações, frontend e build passam.

## Rollback

- Desabilitar as rotas/tela e remover o uso do composer faz o engine voltar ao fallback fixo, mantendo o histórico no banco.
- `active_version_id` pode ser apontado por operação administrativa para uma nova versão restaurada; registros publicados não são apagados.
- Rollback estrutural exige preservar/exportar versões e remover primeiro FKs de runs/usages, ponteiro ativo e tabelas.

## Comandos de validação

```bash
pnpm --filter @atendente/database db:validate
pnpm db:migrate
pnpm db:test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```
