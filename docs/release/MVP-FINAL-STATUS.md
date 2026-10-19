# Status final de readiness do MVP

Data da revisão: 2026-10-18 20:33 -03

Classificação: **MVP NOT READY FOR PILOT**

Base local: `main`, HEAD `05842f817f3edc632d33a9b3cd3df46b9a2a14c3`; validações cobrem alterações locais ainda não commitadas. Nenhuma release/tag foi criada.

## Decisão

O MVP continua bloqueado para piloto porque não há staging provisionado nem runtime de produção aprovado, workflow executado no GitHub/proteção de branch verificada, backup externo ou metas RPO/RTO aprovadas e medidas. O acceptance integrado, os testes locais de logging/correlação e o scan dedicado do histórico Git foram executados e passaram; essas evidências locais não substituem os gates operacionais ausentes.

Não criei TASK-036, funcionalidade ou migration. Não fiz push, deploy, alterações no GitHub, acesso a dados reais ou uso de credenciais reais. O banco usado pelos testes foi descartável; nenhum banco persistente foi alterado.

## Estado dos gates

| Gate                                      | Estado                                    | Evidência                                                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceptance conectado local                | **PASS local**                            | `pnpm db:test`: 307/307; acceptance Nest/HTTP + PostgreSQL 17 + Redis 7.4 + worker real e FakeAI provider; detalhes e correlation IDs em [MVP-STAGING-SMOKE-REPORT.md](MVP-STAGING-SMOKE-REPORT.md).              |
| Smoke em staging                          | **BLOCKING / não executado**              | Staging, domínio HTTPS e credenciais sintéticas de provider não foram disponibilizados. Localhost não foi classificado como staging.                                                                              |
| CI                                        | **BLOCKING / não comprovado remotamente** | Workflow local atualizado; nenhum workflow/run remoto visível foi verificado nesta rodada. A execução local não equivale a um CI verde no commit candidato.                                                       |
| Proteção de branch                        | **BLOCKING / não comprovada**             | Requer configuração e verificação no GitHub após workflow/check existir. Nenhuma alteração remota foi feita.                                                                                                      |
| Runtime de produção                       | **BLOCKING / não provisionado**           | `pnpm build` e `docker build` passaram. O Dockerfile termina em `CMD ["pnpm", "dev"]`, portanto essa imagem não é runtime de produção.                                                                            |
| Backup externo                            | **BLOCKING / ausente**                    | O dump/restore local anterior em PostgreSQL 17 descartável continua válido como evidência técnica local; não existe destino externo, política de retenção ou restore externo demonstrado.                         |
| RPO/RTO                                   | **BLOCKING / não aprovados nem medidos**  | RPO ≤ 24 h e RTO ≤ 4 h seguem apenas propostas de planejamento, não metas aceitas nem resultados medidos.                                                                                                         |
| Redaction e correlação local              | **PASS local**                            | Acceptance conectado validou sentinelas ausentes dos logs e correlação entre webhook, audit, AI run e audit da consulta; ver relatório de smoke. Infraestrutura de coleta/retenção e operador continuam ausentes. |
| Scan de secrets no histórico              | **PASS local**                            | Gitleaks 8.24.2 por digest analisou histórico, patch rastreado e arquivos novos de readiness/ignore; fixture estática foi classificada como falso positivo. O workflow local repete o scan; falta run remoto.     |
| Isolamento/RBAC e regressões de segurança | **PASS local**                            | Acceptance integrado e suites existentes; acesso cross-tenant por ID conhecido foi recusado sem mutação. Não substitui smoke no runtime de staging.                                                               |

Google Calendar permanece **DEFERRED** somente com integração desabilitada e `calendar_provider = NOT_REQUIRED`. Performance e escala permanecem **DEFERRED** apenas para piloto pequeno, sem expansão horizontal. Não são blockers novos nesta revisão.

## Acceptance e smoke

O teste `acceptance conectado: webhook, engine, scheduling, workers, handoff e tenant isolation` executou aplicação Nest real via HTTP, webhook assinado, PostgreSQL/Redis efêmeros, FakeAIProvider, Conversation Engine, Tool Gateway, serviços reais, HOLD/Appointment, audit, notificação e worker. Também verificou reprocessamento, handoff/claim, health/readiness, dados cross-tenant conhecidos e ausência de sentinelas nos logs. A suíte integrada final terminou com **307 testes aprovados, 0 falhas**. Os quatro IDs sintéticos de correlação estão no relatório local; não representam execução em staging.

O checklist de smoke de staging está em [MVP-PILOT-CHECKLIST.md](MVP-PILOT-CHECKLIST.md). A execução não foi possível sem ambiente implantado. A tabela de checks não executados e os pré-requisitos estão em [MVP-STAGING-SMOKE-REPORT.md](MVP-STAGING-SMOKE-REPORT.md).

## Backup e operação

Foi previamente validado dump/restore em PostgreSQL 17 descartável após 35 migrations, com tenant sintético restaurado em database separado. Isso não comprova backup externo, frequência, retenção, criptografia, dono operacional, RPO/RTO nem tempo de recuperação. É necessário selecionar o ambiente/destino real, aprovar metas, configurar cópia externa monitorada e executar restore cronometrado sem tocar produção.

Ainda é necessário designar responsável por monitorar failed jobs, erros de webhook/IA, saúde de DB/Redis e heartbeat do worker durante piloto. Nenhum sistema de observabilidade ou processo operacional foi provisionado nesta revisão.

## Validação local executada

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS, suíte unitária dos pacotes (resultado da execução após ajustes registrado na sessão).
- `pnpm db:test` — PASS, 307 testes; migrations desde zero, reaplicação/seed e suites de integração em PostgreSQL/Redis descartáveis.
- `pnpm build` — PASS, 7/7 tarefas.
- `docker build -t atendente-ia:readiness-check .` — PASS; imagem de desenvolvimento, sem execução/implantação.
- `pnpm db:validate` e `pnpm audit` — PASS na rodada desta revisão; nenhum advisory conhecido.
- Gitleaks no histórico Git, patch rastreado e arquivos novos de readiness/ignore — PASS sem segredo confirmado; um `AUTH_SECRET` literal de teste foi classificado como fixture estática.
- `git diff --check` — PASS.

O scan e os testes usam dados sintéticos. `.env` não foi lido. A imagem local `atendente-ia:readiness-check` foi criada somente para validação e removida após o build.

## Próximos passos para desbloqueio

1. Provisionar staging aprovado para Web/API/Worker, PostgreSQL e Redis, domínio HTTPS, segredos sintéticos e controles de observabilidade; executar o smoke completo e guardar o relatório.
2. Publicar o candidato pelo processo autorizado, obter workflow remoto verde e verificar required checks/proteção da branch principal.
3. Selecionar destino externo de backup, retenção, criptografia e responsável; aprovar RPO/RTO e demonstrar restore externo cronometrado.
4. Aprovar e provisionar runtime de produção, com comandos `start`/health, migração controlada e rollback testado. O Dockerfile atual é de desenvolvimento.
5. Designar operador para acompanhar os sinais do piloto e suspender automações em anomalia.

Até que esses itens sejam verificados, manter **MVP NOT READY FOR PILOT** e não enviar mensagens a usuários externos nem inserir dados reais de pacientes.
