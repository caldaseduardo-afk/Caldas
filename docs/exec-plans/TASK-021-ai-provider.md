# TASK-021 — AI Provider

## Objetivo e escopo

Adicionar contrato independente de SDK, OpenAI Responses API e fake, configuração por
ambiente, contexto mínimo sanitizado, erros seguros, retries limitados e consumo por tenant.
Sem endpoint público, engine, tools, ações de negócio, WhatsApp automático ou TASK-022.

## Decisões antes da implementação

- Contratos em packages/domain; SDK somente no adaptador OpenAI em apps/api/src/ai.
- AIService interno usa sessão/TenantContext e settings.manage (acesso administrativo
  conservador nesta base sem engine). Não aceita tenant no payload. Repository revalida
  autorização. Configuração global por ambiente nesta etapa; resolver separado permite
  futura configuração por clínica sem criar tabela prematura.
- Roles SYSTEM/USER/ASSISTANT são diferentes de Message.senderType; conversão de mensagens
  persistidas é responsabilidade futura do engine. Instruções somente por código confiável.
- Whitelist de campos e limites de mensagens; sanitização de padrões conhecidos de CPF,
  email, telefone e credenciais; objetos completos de paciente/tenant são rejeitados.
  Redação não detecta todo dado clínico em texto livre: seleção mínima é obrigação do chamador.
- Responses API, store:false, sem tools; opção JSON schema estrito, resultado continua dado
  não confiável. Rejeitar respostas vazias, recusas e incompletas sem repetir resposta útil.
- Key, base URL, modelo, timeout e limite de saída vêm do ambiente. Ausência falha no primeiro
  uso. Nenhuma chamada paga nos testes. Timeout por tentativa; retries próprios limitados,
  SDK maxRetries=0; backoff limitado e respeito a Retry-After quando cabe no limite.
- Retry apenas rede/timeout/429 transitório/5xx, nunca auth/config/request/quota permanente.
  Timeout pode ter sido processado e cobrado; não há exactly-once nem idempotência inferida
  do correlationId. Usage desconhecido permanece null, nunca zero inventado.
- AIUsage registra intenção antes de HTTP, resultado técnico após, sem conteúdo. Snapshot
  autorizado vincula conclusão ao registro/tenant originais mesmo após mudança de sessão.
  Não manter transação aberta durante inferência. Falha de persistência não repete inferência.
  Custo nullable Decimal, sem tabela de preços nem consulta externa. Consumo retornado não
  inclui tentativas falhas de custo desconhecido; registrar número de tentativas.
- Logs allowlist de IDs UUID/modelo validado/provider/status/latência/tokens/erro seguro.
  Sem debug de conteúdo. Provider não acessa banco, logger ou serviços de negócio.

## Arquivos e banco previstos

Novo ai-provider.ts no domínio; módulo AI, config, sanitização, provider, fake, service e
repository na API; testes unitários e integração PostgreSQL; AppModule, dependências/lock,
.env.example, docs/integrations.md/domain-model.md; schema e migration aditiva AIUsage.
Índices tenant/data e tenant/correlation; provider/model/data para consumo operacional.
FK tenant obrigatória, UUIDs, tokens inteiros não negativos, custo Decimal nullable.

## Testes e critérios de aceite

DI, configuração, mensagens/parâmetros/JSON, sanitização, metadata, timeout/retry/erros,
resposta inválida, ausência de ferramentas/acesso a banco no provider; persistência,
autorização e concorrência entre tenants, revogação, nenhuma ação por output do modelo.
Mocks de HTTP do SDK; nenhuma dependência de chave real. Cobrir 44 cenários do pedido.

## Comandos de validação

pnpm db:validate; pnpm db:migrate (após revisão da migration); pnpm lint;
pnpm typecheck; pnpm test; pnpm db:test; pnpm build; git diff --check.
Testes de provider/retry e isolamento estarão incluídos nas suítes acima.

## Riscos e rollback

Homologação real não executada. Conteúdo textual exige minimização explícita pelo futuro
chamador. Falhas ambíguas podem custar tokens sem usage disponível. Processo interrompido
pode deixar PENDING para análise posterior, sem retry automático. Remover configuração
suspende inferência; manter tabela aditiva/histórico para rollback sem perda de consumo.

## Estado

Concluída em 2026-10-05. Plano criado antes da implementação. TASK-022 não iniciada.

## Entrega implementada

- Contrato AIProvider/AIRequest/AIResponse/AIModelConfig/AIProviderError independente do SDK.
  Roles SYSTEM/USER/ASSISTANT não convertem Message automaticamente.
- OpenAI SDK 7.28.0 encapsulado em um adaptador; Responses API, store:false, logLevel off,
  maxRetries 0. Fetch injetável nos testes. Nenhuma chamada real ou chave real usada.
- AIService com DI, autorização settings.manage e tenant da sessão; repository revalida;
  consulta interna exige analytics.view. Sem endpoints públicos. FakeAIProvider só via teste.
- Configuração lazy por ambiente e Compose somente API. Modelo solicitado registrado como
  model (sem aceitar metadata arbitrária do provider); limites e temperatura centralizados.
- Retry manual exponencial limitado (0–3 retries), timeout total por tentativa inclusive
  corpo HTTP, respeita Retry-After ou encerra se excede orçamento. Quota/auth/payload/config/
  resposta inválida não repetem. Timeout/rede podem ter custo não informado.
- JSON schema preparado como text.format strict; validação local de sintaxe JSON, não de
  regra de negócio. Consumidor futuro deve validar seu schema antes de usar output.
- Sanitização e whitelist na aplicação e na fronteira HTTP; credenciais em texto/JSON,
  CPF, email e telefone redigidos. Não prometer detecção de todo conteúdo clínico em prosa.
- AIUsage PENDING antes da chamada, conclusão atômica por capability id/tenant privado,
  uma única finalização. Revogação não perde consumo iniciado; impede novas chamadas.
  Falha final de persistência gera log seguro e deixa PENDING sem repetir inferência.
- Tokens capturados quando presentes, inclusive resposta incompleta; null quando ausentes.
  Custo Decimal nullable, sem tabela de preços. Correlation UUID não é idempotência.

## Arquivos criados

- docs/exec-plans/TASK-021-ai-provider.md
- packages/domain/src/ai-provider.ts
- apps/api/src/ai/ai-context.ts
- apps/api/src/ai/ai.config.ts
- apps/api/src/ai/ai.module.ts
- apps/api/src/ai/ai.service.ts
- apps/api/src/ai/ai-usage.repository.ts
- apps/api/src/ai/openai.provider.ts
- apps/api/src/ai/fake-ai.provider.ts
- apps/api/test/ai-provider.test.ts
- apps/api/integration/ai-provider.test.ts
- packages/database/prisma/migrations/20261005020000_ai_usage/migration.sql

## Arquivos alterados

- packages/domain/src/index.ts
- packages/database/prisma/schema.prisma
- apps/api/src/app.module.ts
- apps/api/package.json
- pnpm-lock.yaml
- .env.example
- compose.yaml
- README.md
- docs/architecture.md
- docs/domain-model.md
- docs/integrations.md

Alterações anteriores do workspace foram preservadas. Sem commit, deploy ou reconstrução
de imagens Docker nesta tarefa. Migration histórica não foi alterada.

## Modelo, índices e constraints

Adicionado apenas AIUsage; Tenant ganha relação aiUsages. Nenhum enum Prisma novo (status
limitado por CHECK). FK tenant_id restritiva; índices tenant/data, tenant/correlation,
provider/model/data. CHECKs: tokens nulos em conjunto ou não negativos e soma coerente,
custo não negativo, attempts 0–4 e consistência PENDING/SUCCESS/ERROR com conclusão/latência.
Migration 20261005020000_ai_usage revisada e aplicada localmente, além de recriada e
reaplicada na suíte isolada. 19 migrations totais no repositório.

## Cobertura dos cenários do pedido

- 1–14, 27–28: DI real/fake; config/key/model/timeout/roles/system/retorno/tokens/metadata.
- 15–16, 35–37: tenant da sessão, payload sem override, repository revalida, correlação,
  chamadas concorrentes de A/B e tentativa de scope forjado.
- 17–26, 38–40: logs sem conteúdo/secrets, erros seguros, auth/rate/quota/5xx/rede/timeout,
  Retry-After, limites, vazio/incompleto/malformado/recusa, config lazy e env sem chave.
- 29–34: teste estrutural de imports; output com comandos não cria Appointment/Hold/Message/
  Conversation; whitelist/sanitização, inclusive segredos serializados em JSON.
- Adicionais: timeout de corpo pendente, ausência de usage, tokens de resposta incompleta,
  início persistido antes da inferência, revogação durante chamada, conclusão única,
  falha na gravação não repete provider, CHECK/FK no PostgreSQL, API sem chave segue saudável.
- 41–44: validações gerais abaixo.

## Comandos adicionais de implementação

pnpm --filter @atendente/api add openai; pnpm --filter @atendente/database build;
pnpm --filter @atendente/api typecheck; pnpm --filter @atendente/api test;
pnpm exec prettier --write (arquivos novos TypeScript).
Prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
produziu SQL revisado, depois acrescido de CHECKs. Tentativa inicial com --from-migrations
não alterou banco e falhou por ausência de shadowDatabaseUrl; diff da base local foi usado.

## Validações finais — 2026-10-05

| Comando          | Resultado                                                      |
| ---------------- | -------------------------------------------------------------- |
| pnpm db:validate | Schema válido                                                  |
| pnpm db:migrate  | 20261005020000_ai_usage aplicada com sucesso                   |
| pnpm lint        | 8 tarefas aprovadas                                            |
| pnpm typecheck   | 11 tarefas aprovadas                                           |
| pnpm test        | 124 testes: API 102, web 16, database 3, worker 3; zero falhas |
| pnpm db:test     | API 236 + database 2 = 238; zero falhas                        |
| pnpm build       | 7 tarefas aprovadas                                            |
| git diff --check | Aprovado                                                       |

34 testes unitários novos de IA e 11 subcenários de integração (12 contando a suíte).
Suíte de banco valida instalação do zero, reaplicação, seed, autorização e isolamento.
Após revisão da redação de credenciais em JSON, lint/typecheck/test/build rodaram novamente.
Nenhuma chamada real à OpenAI. Logs de validação em /tmp/task021-*.log.

Correções durante validação: tipagem da fixture de Request; reforço de sanitização de
credenciais serializadas; propagação de variáveis AI no Compose; opções de retry vazias
usam defaults centrais, mantendo campos obrigatórios sem defaults silenciosos.

## Riscos e pendências operacionais

- Homologação com modelo/conta reais permanece não executada; requer configuração e
  avaliação do operador. Não foi necessário solicitar ou usar credenciais reais.
- Custo estimado fica null; usage não recupera custos desconhecidos de tentativas falhas.
- Crash/falha de persistência pode deixar PENDING; não há reenvio automático por esse estado.
- Sanitização por padrões não substitui minimização de texto clínico pelo chamador.
- JSON schema de negócio precisa ser validado pelo futuro consumidor; output é dado inerte.
- Não há erro de lint/typecheck/test/build ou migration pendente. Testes de navegador não
  foram repetidos nesta tarefa sem alteração de frontend. Imagens Docker não reconstruídas.
- Nenhuma implementação da TASK-022 ou das tasks posteriores foi iniciada.
