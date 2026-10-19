# Fechamento de readiness do MVP para piloto controlado

## Objetivo

Revisar o resultado da TASK-035 (`MVP RC BLOCKED`), tentar resolver lacunas locais
verificáveis sem adicionar comportamento de produto e consolidar a decisão de
readiness do piloto. Não criar tarefa de produto nem alterar funcionalidades.

## Baseline

- Branch `main`, HEAD `ea9ca687d0311f66ff05405ae27d8ca995062a2d`.
- Working tree já contém as alterações das TASKs 032–035, inclusive o checklist RC.
  Preservar tudo; distinguir arquivos desta atividade.
- TASK-035 não encontrou falha nos testes/build/audit locais. Bloqueios: falta de
  acceptance E2E de uma ponta à outra, ausência de ambiente/provider real, restore
  real/RPO/RTO, runtime de produção, CI remota e pontos de shutdown/logging.
- `gh run list --repo caldaseduardo-afk/Caldas --limit 5` retornou `[]` (nenhuma
  execução remota visível). Nenhuma credencial/provider/deploy operacional foi
  disponibilizada nesta sessão.

## Escopo e arquivos previstos

- Revisar `AGENTS.md`, `BACKLOG.md`, documentos funcionais/segurança e os quatro
  documentos da TASK-035.
- Criar um acceptance E2E integrado determinístico se for possível fazê-lo usando
  serviços e fakes já existentes, sem introduzir provider fake de produção.
- Ensaiar dump/restore somente em PostgreSQL descartável, sem tocar volumes locais
  persistentes, e registrar limites do ensaio.
- Criar `docs/release/MVP-PILOT-CHECKLIST.md` e
  `docs/release/MVP-FINAL-STATUS.md`; revisar known issues para status inequívoco.
- Se o E2E exigir modificação ampla de runtime ou nova infraestrutura, parar na
  documentação e classificar como BLOCKING, sem redesenhar arquitetura.

## Continuação autorizada — evidências dos blockers

Antes desta etapa, a matriz é:

| Blocker              | Evidência existente                                           | Evidência faltante                                                                                        | Ação necessária                                                                                   |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Acceptance conectado | Suites separadas; restore local DB testado                    | API → Engine → Tool Gateway → Appointment → audit/notification em uma execução e Web/API smoke em staging | Acceptance local com DB/Redis/worker reais e provider fake; staging permanece BLOCKING se ausente |
| Staging/runtime/CI   | Workflow local e comandos `start` existem                     | Web/API/worker implantados, smoke HTTPS, run remoto verde e proteção de branch                            | Validar build/comandos locais; consultar GitHub; sem push/deploy nem regra insegura               |
| Backup/RPO/RTO       | Restore local PostgreSQL 17, 35 migrations, tenant sintético  | Cópia externa, retenção/owner, metas aprovadas e restore medido                                           | Propor RPO/RTO condicionados à frequência; sem provider selecionado, BLOCKING                     |
| Logging/correlation  | Allowlist de alguns loggers e `AIProcessingRun.correlationId` | Sentinel sem valores e correlation propagada até audit, logs e fila                                       | Testes redacted/correlation no acceptance e unit; revisar logs de integração                      |
| Secret history scan  | Nenhum scan dedicado anterior; `.env` local ignorado não lido | Scanner histórico, finding classificado e scan da árvore de trabalho                                      | Gitleaks em container pinado; fingerprint de fixture classificado sem mostrar valor               |

As pendências externas são operacionais. Não alterar serviços remotos, não fazer
push e não ler `.env`. Não adicionar lógica genérica de redaction sem finding
reprodutível.

## Banco e rollback

Nenhuma migration prevista. Restore será para instância/database temporária isolada,
com volume efêmero, removido após validar. Não usar `compose.yaml` nem volume
persistente do projeto. Nenhuma alteração de dados reais. Correção/teste adicional
é reversível por arquivo; manter histórico local anterior.

## Riscos

- Provedores reais, webhook Meta, deploy HTTPS e credenciais não estão disponíveis;
  testes locais não podem provar entregabilidade nem configuração operacional.
- GitHub não expôs runs de Actions para o repo consultado. Não publicar branch,
  disparar deploy ou alterar proteção remota sem solicitação.
- E2E atravessando runtime, providers e fila pode ser inviável com as interfaces
  atuais; não contornar autorização ou habilitar fakes em produção.

## Validações

- Teste novo/afetado com PostgreSQL 17 e Redis 7.4 descartáveis via `pnpm db:test`.
- Restore test em PostgreSQL isolado, migration status e contagem sintética após
  restaurar.
- Repetir lint/typecheck/unit/build se código de teste for alterado; executar
  regressões de tenant, WhatsApp, engine, scheduling, worker e Calendar.
- Rever config/secrets, `pnpm audit`, `git diff --check` e formatação dos documentos.

## Critérios de saída

- Todo known issue está `RESOLVED`, `ACCEPTED`, `DEFERRED` ou `BLOCKING`, com
  evidência/razão. Pendência de operação externa sem evidência continua BLOCKING
  quando impede uso seguro do piloto.
- Checklist de piloto cobre serviços, flags, monitoramento, backup, restore,
  rollback, smoke sintético e perfis.
- Declarar `MVP READY FOR CONTROLLED PILOT` somente se fluxo principal, isolamento,
  implantação e recuperação tiverem evidência suficiente; caso contrário declarar
  `MVP NOT READY FOR PILOT` e nomear bloqueios.
- Não criar TASK-036 nem evolução de produto.

## Resultado

Execução inicial em 2026-10-18:

- TASK-035 terminou como `MVP RC BLOCKED`; os achados e critérios originais foram
  revisados. Nenhuma alteração de produto, código, testes ou migration foi feita
  nesta atividade.
- Foi executado restore descartável em PostgreSQL 17: 35 migrations em um
  container com filesystem efêmero, tenant sintético, dump custom e restore em
  database separado; a linha foi verificada após restaurar e o container foi
  removido. Isso não substitui backup externo nem mede RPO/RTO.
- No snapshot inicial, o acceptance E2E conectado não havia sido adicionado;
  essa lacuna foi trabalhada na continuação descrita abaixo.
- `MVP-KNOWN-ISSUES.md` foi atualizado com estados inequívocos. OAuth Calendar e
  performance ficam DEFERRED somente sob condições explícitas; itens que afetam
  segurança, fluxo ou deployment continuam BLOCKING.
- Criados `docs/release/MVP-PILOT-CHECKLIST.md` e
  `docs/release/MVP-FINAL-STATUS.md`; o checklist cobre ambientes, variáveis,
  flags, dados sintéticos, smoke, observabilidade, rollback e restore.
- Nenhuma credencial/staging foi disponibilizada. Não houve deploy, publicação,
  mudança remota ou acesso a dados reais. No snapshot inicial ainda faltava scan
  dedicado; a continuação abaixo executou Gitleaks. CI/branch protection remota
  continua sem comprovação.
- Resultado final: `MVP NOT READY FOR PILOT`. A evidência do restore local reduziu
  uma lacuna técnica, mas não fecha os gates operacionais exigidos.

Validação final:

- `pnpm db:validate`: PASS.
- PostgreSQL 17 disposable migrations/dump/restore com tenant sintético: PASS.
- Prettier nos quatro documentos da atividade: PASS.
- `git diff --check`: PASS.
- `.env` não está tracked; há um `.env` local ignorado. Seu conteúdo não foi lido
  nem usado. Isso não certifica ausência de segredo no histórico.
- Essa foi a validação do snapshot inicial, antes da continuação de código/teste
  descrita abaixo; ela não representa os resultados finais desta revisão.

Completar abaixo após executar a continuação dos blockers; os resultados iniciais
acima permanecem como histórico e não devem ser tratados como validação atual de
testes/código alterados posteriormente.

## Continuação em 2026-10-18

O acceptance conectado foi implementado em
`apps/api/integration/pilot-acceptance.test.ts`. Ele inicia a aplicação Nest real,
usa HTTP para login/webhook assinado, PostgreSQL e Redis descartáveis, faz DI do
`FakeAIProvider`, executa o Conversation Engine/Tool Gateway/fluxo de agenda, inicia
o worker real de notificações, verifica deduplicação e handoff e tenta acessar
recursos conhecidos do tenant sentinela. O fluxo também verifica health/ready,
logs sem sentinelas e igualdade de correlation ID entre webhook, audit, AI run e
Appointment audit. A execução final de `pnpm db:test` passou com 307/307 testes;
quatro IDs sintéticos constam em `docs/release/MVP-STAGING-SMOKE-REPORT.md`.

As primeiras execuções revelaram `AI_BAD_REQUEST` antes do FakeAIProvider: o prompt
do engine excedia 16k porque as definições de 13 tools estavam duplicadas, e a
sanitização de telefone alterava dígitos em schemas JSON confiáveis. A correção
remove a duplicação, permite 32k somente para instruções do sistema, preserva
schemas sob verificação explícita de segredos e ajusta a regex telefônica. Testes
unitários específicos foram adicionados.

Gitleaks 8.24.2 foi executado em container. O primeiro scan histórico identificou
um único `generic-api-key` em `apps/api/test/rate-limit.test.ts:8`; a linha declara
`AUTH_SECRET` de fixture, sem credencial de serviço. O finding foi classificado
como FALSE_POSITIVE, e somente seu fingerprint histórico foi adicionado a
`.gitleaksignore`. A repetição do histórico terminou com zero findings; o diff da
árvore de trabalho também terminou com zero findings. `.github/workflows/ci.yml`
agora baixa o histórico e executa essa imagem pelo digest verificado.

O GitHub foi consultado sem escrita: branch padrão `main`, conta autenticada com
permissão `admin`, mas nenhum workflow/run CI aparece no remoto e `main` não tem
proteção. Não configurei required checks antes da workflow existir no remoto e
produzir um check verde, pois isso poderia deixar a branch sem caminho seguro de
merge. Nenhum push/deploy ou alteração remota foi feito.

Infraestrutura externa de staging/backup não existe nesta sessão. Metas propostas
para aprovação operacional: RPO ≤ 24 horas com snapshots diários criptografados
em destino externo e cópia concluída/alertada; RTO ≤ 4 horas, ainda TARGET e não
medido. Sem provedor, retenção, responsável e restore externo comprovados, os dois
gates continuam BLOCKING. O restore local descartável de PostgreSQL 17/35
migrations executado anteriormente continua sendo evidência técnica local, não
backup operacional.

## Validação final em 2026-10-18

- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS; suites unitárias dos pacotes passaram após as correções.
- `pnpm db:test`: PASS, 307 testes e 0 falhas; migrations desde zero,
  reaplicação, seed e integração com PostgreSQL/Redis descartáveis passaram.
- `pnpm build`: PASS, 7/7 tarefas.
- `docker build -t atendente-ia:readiness-check .`: PASS. O Dockerfile usa
  `CMD ["pnpm", "dev"]`; portanto o build não comprova runtime de produção. A
  imagem local foi removida depois da validação.
- Gitleaks 8.24.2 por digest: scan do histórico Git, patch rastreado e arquivos
  novos de readiness/ignore PASS; o único fingerprint detectado foi classificado
  como fixture estática falsa positiva.
- `pnpm db:validate`, `pnpm audit` e `git diff --check`: PASS.
- Smoke conectado em staging: NOT RUN; ambiente não provisionado. Resultado e
  pré-requisitos em `docs/release/MVP-STAGING-SMOKE-REPORT.md`.
- Decisão: `MVP NOT READY FOR PILOT`; staging, CI/branch protection remotos,
  runtime de produção, backup externo/RPO/RTO e responsável operacional seguem
  bloqueando. Nenhum push, deploy ou alteração remota foi realizado.
