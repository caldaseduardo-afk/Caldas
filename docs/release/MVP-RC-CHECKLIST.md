# MVP Release Candidate — checklist de validação

Data: 2026-10-18. Branch `main`, HEAD `ea9ca687d0311f66ff05405ae27d8ca995062a2d`. As alterações locais anteriores das TASKs 032–034 foram preservadas. Nenhuma migration foi criada nesta tarefa.

Estados: **PASS** = evidência local reproduzível; **FAIL** = comportamento falhou; **BLOCKED** = evidência obrigatória não exercitada; **N/A** = fora do produto/infra atual.

## Resultado

**MVP RC BLOCKED.** As validações locais passaram, mas não há prova do fluxo principal completo em uma única execução conectada e faltam validações com providers/infra reais. Ver [known issues](MVP-KNOWN-ISSUES.md).

## Validação de engenharia

| Verificação       | Estado                        | Evidência                                                                                                                                                                                                                          |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lockfile          | PASS                          | `pnpm install --frozen-lockfile`, lockfile sem mudança.                                                                                                                                                                            |
| Prisma            | PASS                          | `pnpm db:validate`, schema válido.                                                                                                                                                                                                 |
| Migrations        | PASS                          | `pnpm db:test`: PostgreSQL 17 descartável, 35 migrations desde zero; reaplicação sem pendências.                                                                                                                                   |
| Seed              | PASS                          | Mesmo teste: seed duas vezes, sem duplicar catálogo.                                                                                                                                                                               |
| Lint              | PASS                          | `pnpm lint`, oito pacotes.                                                                                                                                                                                                         |
| Typecheck         | PASS                          | `pnpm typecheck`, 12 tarefas Turbo.                                                                                                                                                                                                |
| Unit              | PASS                          | `pnpm test`, incluindo 161 testes API e testes dos demais pacotes; zero falhas.                                                                                                                                                    |
| Integration       | PASS                          | `pnpm db:test`: 5 testes database e 303 integrações API, PostgreSQL e Redis descartáveis.                                                                                                                                          |
| Browser E2E       | PASS com limite               | `pnpm --filter @atendente/web test:e2e`: 25 passaram; API não foi iniciada, `/realtime` registrou `ECONNREFUSED`, então não prova Web + API conectados.                                                                            |
| Build             | PASS                          | `pnpm build`, sete targets incluindo Next produção.                                                                                                                                                                                |
| Docker            | PASS local / BLOCKED produção | `docker build -t atendente-task035-rc .` passou; imagem `sha256:94e99ebc7d4e39577c9c2ed0786bd972bf866dcf64e5ce8ed398d2fd6b3f2a0f`, usuário `node`. Dockerfile/Compose atuais são para desenvolvimento; não há runtime de produção. |
| Dependency audit  | PASS                          | `pnpm audit`, nenhum advisory conhecido.                                                                                                                                                                                           |
| Secret scan       | PASS limitado                 | Busca textual do working tree sem segredo real; encontrou só `sk-test-only-not-a-real-key` em fixture. Scanner dedicado/histórico não disponível.                                                                                  |
| Diff check        | PASS                          | `git diff --check`.                                                                                                                                                                                                                |
| Banco persistente | N/A                           | Nenhuma migration aplicada a banco de desenvolvimento/produção.                                                                                                                                                                    |
| Versão/tag RC     | N/A                           | Pacotes permanecem `0.0.0`; sem convenção de versão/tag RC.                                                                                                                                                                        |

## Funcionalidade do MVP

| Feature                                                                         | Estado                       | Evidência                                                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact                                                                         | PASS                         | `contacts.test.ts`, `whatsapp.test.ts`: normalização, duplicidade e isolamento.                                                                     |
| Patient/representative                                                          | PASS                         | `patients.test.ts`, `tool-gateway.test.ts`: autorização, revogação, representante e isolamento.                                                     |
| Scheduling                                                                      | PASS                         | `ai-scheduling.test.ts`, `availability.test.ts`, `holds.test.ts`, `appointments.test.ts`: disponibilidade real, HOLD, concorrência, estados.        |
| Cancellation/rescheduling                                                       | PASS                         | `ai-appointment-changes.test.ts`: confirmação explícita, atomicidade, idempotência, preservação do original.                                        |
| Notifications                                                                   | PASS                         | `notifications.test.ts`, `worker-automations.test.ts`: janelas, timezone, retries, skip e recovery.                                                 |
| Inbox                                                                           | PASS                         | `inbox.test.ts`, `conversations.test.ts`: filtros, paginação, histórico e RBAC.                                                                     |
| Handoff/SLA                                                                     | PASS                         | `handoff.test.ts`, `human-sla.test.ts`: disputa de agentes, ownership, FIRST/SECOND/EXTERNAL, audit e realtime.                                     |
| Knowledge                                                                       | PASS                         | `knowledge.test.ts`: draft, publish, retrieval, versionamento, injection e tenant.                                                                  |
| AI configuration                                                                | PASS                         | `ai-configuration.test.ts`: draft/publicação/rollback; simulation protegida nas suites.                                                             |
| WhatsApp                                                                        | PASS com provider controlado | `whatsapp.test.ts`: HMAC, duplicata, ingresso, persistência, retry e realtime. Sem callback/entrega Meta real.                                      |
| AI/Tool Gateway                                                                 | PASS com fake                | `ai-provider.test.ts`, `tool-gateway.test.ts`: schemas, autorização, limites e erros; sem credencial/provedor real.                                 |
| Google Calendar                                                                 | PASS com fake                | `packages/database/test/calendar.integration.ts`, `worker-automations.test.ts`: retry, crash-before-commit, reconciliação e dedupe; sem OAuth real. |
| Audit                                                                           | PASS                         | `audit.test.ts` e suites de domínio: actor/tenant, atomicidade e minimização.                                                                       |
| Clinic dashboard                                                                | PASS                         | `analytics.test.ts`: fórmulas, timezone/DST e isolamento.                                                                                           |
| Super Admin                                                                     | PASS                         | `platform.test.ts`, `platform-totp.test.ts`: TOTP, limites, projeções e isolamento.                                                                 |
| Plans/usage                                                                     | PASS                         | `platform.test.ts`, `plans.test.ts`: limites, ciclos, agregados e tenant.                                                                           |
| Fluxo de aceite conectado WhatsApp→engine→Appointment→outbox→Calendar→dashboard | BLOCKED                      | Ingresso/WhatsApp, scheduling e demais componentes passam em suites separadas; nenhuma única integração comprova todo o fluxo.                      |

## Saúde por componente

| Componente      | Estado                         | Evidência                                                                 |
| --------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Web             | PASS local                     | Build e 25 testes Playwright mockados.                                    |
| API             | PASS local                     | Unit, 303 integrações e contratos.                                        |
| Worker          | PASS local                     | BullMQ, outbox, retry, reconciliação e bootstrap.                         |
| PostgreSQL      | PASS local                     | PostgreSQL 17 temporário e 35 migrations limpas/reaplicadas.              |
| Redis           | PASS local                     | Redis 7.4 temporário; rate limit e BullMQ.                                |
| WhatsApp        | BLOCKED produção               | Adapter/testes controlados passam; sem webhook/entrega de staging.        |
| AI              | BLOCKED produção               | Fake/adapter tests passam; sem chave e acceptance de staging.             |
| Google Calendar | BLOCKED produção               | Provider fake/reconciliation passam; OAuth/conta real pendentes.          |
| Notifications   | PASS local                     | Suites de regras/workers e recuperação.                                   |
| WebSocket       | PASS API; UI conectado BLOCKED | 21 cenários WebSocket real passam na integração API; navegador usa mocks. |

## Segurança

| Controle         | Estado            | Evidência/limite                                                                               |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Auth             | PASS              | Sessão/cookie, CSRF/Origin, MFA plataforma, throttling.                                        |
| RBAC             | PASS              | Matriz, 403, revogação e scope de plataforma.                                                  |
| Tenant isolation | PASS local        | Suites HTTP/repository, IDs conhecidos, tools, realtime, dashboard e platform.                 |
| Rate limit       | PASS local        | Redis real temporário, 429 e orçamento isolado por tenant; multi-instância API não testada.    |
| Webhook          | PASS local        | HMAC, schema, tamanho, idempotência; assinatura sem janela replay conforme checklist TASK-034. |
| Tool Gateway     | PASS              | Registry fechado, schema estrito, autorização de backend e nenhum SQL/tool genérica.           |
| Secret redaction | BLOCKED parcial   | Testes de provider passam; scanner de histórico e logger uniforme API→worker ausentes.         |
| XSS              | PASS local        | React escapa texto, KB sanitiza, sem `dangerouslySetInnerHTML`; sem domínio de produção.       |
| SQL injection    | PASS              | Sem raw SQL unsafe; queries parametrizadas e constraints exercitadas.                          |
| SSRF             | PASS por inspeção | Destinos externos configurados/constantes, redirects bloqueados.                               |
| OAuth            | BLOCKED           | Sem fluxo interativo state/callback e rotação automática Google.                               |
| Audit            | PASS              | Ações críticas/transações, autoria e tenant exercitados.                                       |
| Backup/recovery  | BLOCKED           | Runbook criado na TASK-034; backup externo/restore/RPO/RTO não ensaiados.                      |
| Headers/CSP      | PASS local        | Testes API/Next; domínio HTTPS/WebSocket final não verificado.                                 |

## Resiliência e dados

| Cenário                          | Estado               | Evidência/limite                                                                                                        |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Corrida de slots/HOLD            | PASS                 | PostgreSQL, duas instâncias e constraints; um único vencedor.                                                           |
| Expiração HOLD                   | PASS                 | Worker e transições terminais testados.                                                                                 |
| Webhook duplicado/spoof          | PASS                 | Dedupe HTTP e assinatura inválida.                                                                                      |
| Outage AI com inbound preservado | BLOCKED              | Persistência e erros cobertos separadamente; sem E2E conectado.                                                         |
| AI tool loop/output inválido     | PASS local           | Limite e falha segura nas suites engine/gateway.                                                                        |
| Retry/worker concorrente         | PASS local           | Processors concorrentes e idempotência; crash real no efeito/shutdown ativo pendente.                                   |
| Redis loss/recovery              | BLOCKED parcial      | Redis vazio/outbox recovery testados; falta apagar no fluxo ponta a ponta.                                              |
| Calendar crash/duplicate         | PASS com fake        | Provider fake recupera evento criado antes do commit e evita duplicação.                                                |
| Graceful shutdown                | BLOCKED              | Handlers existem; SIGTERM com job ativo não testado como processo E2E.                                                  |
| Integridade de dados             | PASS por constraints | CHECK/FK/exclusion cobrem assignment, tenant composto, holds/appointments, provider ID; sem scanner histórico separado. |
| Performance sanity               | PASS parcial         | Paginação Inbox, agregados, slots e filas cobertos; sem benchmark/latency budget/load test.                             |
| UI manual por perfil             | BLOCKED              | Playwright com mocks; sem sessão real via API para AGENT/ADMIN/SUPER_ADMIN.                                             |
| CI remota/proteção branch        | BLOCKED              | Workflow existe; sem execução remota ou configuração de branch protection comprovada.                                   |

**Decisão:** testes locais passaram, mas a evidência exigida para readiness ainda não existe. Ver [bloqueios e próximos passos](MVP-KNOWN-ISSUES.md).
