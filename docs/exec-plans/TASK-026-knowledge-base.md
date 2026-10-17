# TASK-026 — Base de Conhecimento

## Objetivo

Adicionar uma Base de Conhecimento administrativa por tenant, com revisão/publicação versionada, retrieval limitado no PostgreSQL e uso seguro pelo Conversation Engine. O conteúdo recuperado será tratado como dado não confiável e separado das instruções de sistema; somente versões publicadas, vigentes e pertencentes ao tenant poderão chegar ao AIProvider.

## Escopo

- Criar `KnowledgeArticle` como identidade estável e `KnowledgeArticleVersion` como conteúdo editorial histórico.
- Suportar categorias estruturadas, status `DRAFT`, `PUBLISHED` e `INACTIVE`, slug opcional por tenant e Unit opcional.
- Criar artigo em draft, editar draft com controle otimista, criar nova versão, publicar, inativar, listar versões e consultar a versão publicada.
- Adicionar permissões `knowledge.view`, `knowledge.manage` e `knowledge.publish`; `AGENT` e `DOCTOR` recebem somente leitura, enquanto gestão/publicação ficam restritas a `CLINIC_ADMIN`.
- Auditar criação, atualização, publicação e inativação sem copiar o conteúdo para o evento.
- Implementar `KnowledgeRetriever` tenant-scoped com PostgreSQL full-text search, ranking, validade temporal e limites de resultado/contexto.
- Expor preview administrativo que usa exatamente o mesmo retriever operacional.
- Adicionar a tool interna e estreita `search_knowledge_base`, sem `tenantId` nos argumentos.
- Integrar retrieval ao Conversation Engine apenas quando a IA emitir a tool para intenção informativa; resultados e ausência serão devolvidos como dados delimitados antes da nova inferência.
- Forçar fallback seguro quando a busca não encontrar resultado confiável e preservar o handoff obrigatório para perguntas clínicas fora de conteúdo aprovado.
- Adicionar testes unitários, integração PostgreSQL, segurança, versionamento, isolamento e E2E Conversation Engine/AIProvider.

## Fora de escopo

- Configuração de personalidade, prompt ou modelo por tenant da TASK-027.
- Vector database, embeddings, crawling, upload ou ingestão de PDF/Word.
- Prontuário, dados individuais de pacientes, diagnóstico, prescrição ou interpretação clínica.
- CMS complexo, colaboração em tempo real, cache distribuído ou métricas/dashboard.
- Tela administrativa: o frontend atual contém somente a Inbox e não possui shell administrativo de catálogo. A TASK-026 entregará a API administrativa completa sem introduzir uma nova área de produto não prevista no backlog.
- TASK-027 e posteriores.

## Decisões técnicas

1. `KnowledgeArticle` terá identidade, tenant, slug opcional, Unit opcional, status agregado e autoria. `KnowledgeArticleVersion` guardará title, category, content, tags, source type, validade, número da versão, status e autoria/publicação.
2. Um artigo começa com versão 1 `DRAFT`. Conteúdo publicado nunca será alterado. Editar artigo publicado exige criar uma nova versão draft; publicar a nova versão torna a anterior `INACTIVE`, preservando o histórico.
3. Haverá no máximo uma versão `DRAFT` e uma `PUBLISHED` por artigo, garantidas por índices parciais. A numeração será única por artigo/tenant.
4. Edição de draft exigirá `expectedUpdatedAt`; update condicional impedirá perda silenciosa quando dois editores partirem da mesma revisão.
5. Categoria será enum global porque o conjunto inicial expressa política e segurança (`CLINICAL_APPROVED` exige tratamento distinto). Tags continuam flexíveis para vocabulário específico da clínica.
6. `unit_id` será opcional. FK composta garantirá que a Unit pertença ao mesmo tenant. Retrieval poderá filtrar por Unit e continuará incluindo artigos gerais.
7. A migration adicionará uma coluna gerada `search_vector` em cada versão e índice GIN com configuração `portuguese`. A implementação consultará via repository parametrizado; Prisma não exporá essa coluna técnica ao restante da aplicação.
8. Ranking usará `ts_rank_cd`, com peso A para título e B para conteúdo, além de bônus para correspondência textual exata no título. Tags ficam indexadas em GIN para evolução de filtros, sem alterar o ranking textual nesta task. Apenas candidatos acima de um limiar mínimo serão retornados, ordenados por score, data de publicação e ID.
9. Não haverá chunking nesta versão: cada conteúdo terá limite editorial de 8.000 caracteres; retrieval devolverá até 5 trechos de 1.200 caracteres e no máximo 4.000 caracteres totais. A abstração `KnowledgeRetriever` permite introduzir chunks/pgvector depois.
10. A busca operacional filtrará `article.status=PUBLISHED`, `version.status=PUBLISHED`, `valid_from <= now` e `valid_until >= now`, dentro da própria query que contém `tenant_id`.
11. Conteúdo passará por normalização textual, remoção de tags HTML/controles e `sanitizeAIText`. O resultado será um objeto `knowledgeContext` explicitamente marcado como conteúdo não confiável. Texto da KB nunca será concatenado às instruções de sistema.
12. `search_knowledge_base` será somente leitura e retornará title, category, excerpt, version e uma referência interna mínima. Tenant, status, validade, autoria e conteúdo administrativo completo não serão aceitos nem expostos.
13. O Conversation Engine permitirá a tool apenas para `INFORMATION`. Um resultado vazio produzirá um marcador confiável `knowledgeFound=false`; as instruções exigirão fallback sem afirmação factual. `CLINICAL_QUESTION` continuará fazendo handoff antes de qualquer retrieval. `CLINICAL_APPROVED` poderá ser usado somente quando recuperado explicitamente, sem extrapolação.
14. Não será criada resposta fixa em controller. O AIProvider continuará formulando a mensagem final dentro do JSON Schema existente, depois de receber o resultado seguro da tool.

## Arquivos afetados

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261009040000_knowledge_base/migration.sql`
- `packages/database/src/rbac-catalog.ts`
- `packages/database/src/rbac-seed.ts` e testes relacionados, se necessário
- `apps/api/src/knowledge/*`
- `apps/api/src/tools/*`
- `apps/api/src/conversation-engine/*`
- `apps/api/src/permissions/authorization.service.ts`
- `apps/api/src/app.module.ts`
- testes unitários e de integração relacionados
- `docs/architecture.md`, `docs/domain-model.md`, `docs/security.md` e `docs/conversations.md` quando necessário

## Mudanças de banco

- Enums `KnowledgeArticleStatus`, `KnowledgeCategory` e `KnowledgeSourceType`.
- Tabelas `knowledge_articles` e `knowledge_article_versions` com `tenant_id` obrigatório, autoria, timestamps e FKs compostas.
- Campo gerado de busca e índice GIN PostgreSQL.
- Índices por tenant/status, categoria/status, validade, slug, Unit e publicação.
- Unicidade tenant/slug quando slug não for nulo, tenant/artigo/versão e índices parciais de draft/publicação atual.
- Novos eventos de auditoria e permissões no catálogo RBAC.
- Nenhuma migration histórica será alterada.

## Riscos

- **Prompt injection no conteúdo:** contexto separado das instruções, delimitado como dado não confiável, sanitizado e sem capacidade de executar tools.
- **Vazamento entre tenants:** tenant participa da query FTS e das FKs; não haverá busca global com filtro posterior.
- **Draft usado prematuramente:** retrieval exige status publicado no artigo e na versão; índices separados impedem substituição silenciosa.
- **Resultado irrelevante:** limiar de score, limites pequenos e fallback seguro impedem usar correspondência fraca como verdade.
- **Edição concorrente:** `expectedUpdatedAt` e update condicional retornam conflito em vez de sobrescrever.
- **Conteúdo clínico:** pergunta clínica continua em handoff; artigo `CLINICAL_APPROVED` é dado aprovado para reprodução limitada, não autorização para raciocínio clínico geral.
- **FTS português:** termos muito curtos, siglas e nomes de plano podem ter ranking limitado; título/tags recebem peso e os testes documentarão o comportamento. Evolução para trigram/pgvector fica atrás da abstração.

## Testes

- DTOs, limites, categorias, datas, slug, Unit e mass assignment.
- CRUD, RBAC, auditoria e respostas administrativas mínimas.
- DRAFT/PUBLISHED/INACTIVE, publicação, nova versão, histórico e optimistic locking.
- Mesmo título/slug entre tenants, IDs e Unit cross-tenant.
- Retrieval por relevância, ranking, limite, validade, status, versão e tenant.
- Preview e tool usando o mesmo `KnowledgeRetriever`.
- Schema da tool rejeitando `tenantId`, status, IDs administrativos e payload excessivo.
- Sanitização de HTML/controles, prompt injection e projeção mínima.
- Conversation Engine: INFORMATION com hit, miss seguro, reinferência com contexto, pergunta clínica em handoff e ausência de mutação.
- E2E obrigatório: draft invisível, publicação do artigo de planos, hit para Alfa e miss/fallback para Gama, sem conteúdo de outro tenant.

## Critérios de aceite

- Somente conteúdo publicado e vigente do tenant atual entra no retrieval da IA.
- Publicação e inativação preservam histórico e são auditadas com ator real.
- Edição de conteúdo publicado cria draft separado; concorrência não sobrescreve silenciosamente.
- Busca é limitada, ranqueada, indexada e não carrega a base inteira.
- Conteúdo malicioso permanece dado e não altera system instructions, tools ou banco.
- Miss de conhecimento não produz afirmação inventada.
- Migration, lint, typecheck, testes, E2E e build passam.

## Rollback

- Remover `search_knowledge_base` das capacidades interrompe o uso pela IA sem apagar artigos.
- Inativar artigos retira conteúdo do retrieval preservando o histórico.
- A migration é aditiva; rollback estrutural posterior exige confirmar que não há conteúdo editorial a preservar e remover primeiro FKs/índices/tabelas/enums.

## Comandos de validação

```bash
pnpm --filter @atendente/database db:validate
pnpm db:test
pnpm --filter @atendente/api test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```
