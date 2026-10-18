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

| Blocker | Evidência existente | Evidência faltante | Ação necessária |
| --- | --- | --- | --- |
| Acceptance conectado | Suites separadas; restore local DB testado | Inbound → engine → Tool Gateway → Appointment → audit/notification em uma execução | Acceptance test com API/DB/Redis/workers reais e provider fake externo |
| Staging/runtime/CI | Workflow CI e scripts `start` existem | Ambiente configurado, artifacts/runtime executado, CI remota e branch protection verificada | Validar startup local seguro, consultar GitHub; sem push/deploy |
| Backup/RPO/RTO | Restore local PostgreSQL 17, 35 migrations, tenant sintético | Cópia externa, frequência/retenção/owner e metas aprovadas/medidas | Propor targets sem declarar atingimento; infraestrutura não disponível mantém BLOCKING |
| Logging/correlation | Vários loggers usam allowlists e AIProcessingRun tem correlationId | Captura sentinel, propagação em audit/worker comprovada | Teste de redaction/correlation por fluxo, sem incluir payload |
| Secret history scan | Busca textual anterior; `.env` local ignorado não lido | Scanner dedicado de histórico e working tree | Executar Gitleaks em container temporário, relatório redigido |

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
- O acceptance E2E conectado completo não foi adicionado: ingress, Conversation
  Engine, scheduling, outbox/worker, Calendar e dashboard possuem evidências em
  suites separadas, mas o candidato não dispõe de staging/providers/credenciais
  para validar a cadeia operacional. A lacuna segue BLOCKING.
- `MVP-KNOWN-ISSUES.md` foi atualizado com estados inequívocos. OAuth Calendar e
  performance ficam DEFERRED somente sob condições explícitas; itens que afetam
  segurança, fluxo ou deployment continuam BLOCKING.
- Criados `docs/release/MVP-PILOT-CHECKLIST.md` e
  `docs/release/MVP-FINAL-STATUS.md`; o checklist cobre ambientes, variáveis,
  flags, dados sintéticos, smoke, observabilidade, rollback e restore.
- Nenhuma credencial/staging foi disponibilizada. Não houve deploy, publicação,
  mudança remota ou acesso a dados reais. `gitleaks`/`trufflehog` não estão
  instalados; secret scan histórico segue BLOCKING. CI/branch protection remota
  também não foi comprovada.
- Resultado final: `MVP NOT READY FOR PILOT`. A evidência do restore local reduziu
  uma lacuna técnica, mas não fecha os gates operacionais exigidos.

Validação final:

- `pnpm db:validate`: PASS.
- PostgreSQL 17 disposable migrations/dump/restore com tenant sintético: PASS.
- Prettier nos quatro documentos da atividade: PASS.
- `git diff --check`: PASS.
- `.env` não está tracked; há um `.env` local ignorado. Seu conteúdo não foi lido
  nem usado. Isso não certifica ausência de segredo no histórico.
- `pnpm lint`, `pnpm typecheck`, unit, integração, browser E2E, build e `pnpm
audit` não foram repetidos: somente documentação foi alterada; resultados PASS e
  limitações permanecem os registrados pela TASK-035.

Completar abaixo após executar a continuação dos blockers; os resultados iniciais
acima permanecem como histórico e não devem ser tratados como validação atual de
testes/código alterados posteriormente.
