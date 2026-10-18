# Status final de readiness do MVP

Data da revisão: 2026-10-18  
Classificação: **MVP NOT READY FOR PILOT**  
Versão: pacotes permanecem `0.0.0`; nenhuma tag/release foi criada.  
Checkout: branch `main`, HEAD `ea9ca687d0311f66ff05405ae27d8ca995062a2d`; working tree inclui alterações locais anteriores das TASKs 032–035 e não foi publicado.

## Decisão

O candidato não está pronto para receber tráfego de piloto. A TASK-035 terminou
`MVP RC BLOCKED`. Esta revisão não encontrou regressão reprodutível de código; fez
um ensaio local de backup/restore em PostgreSQL efêmero e consolidou os controles
operacionais. Permanecem blockers objetivos: não há aceite conectado de todo o
fluxo, deployment/staging com provedores reais, runtime de produção aprovado, CI
remota/proteção de branch comprovadas, scanner de segredo no histórico ou cópia
externa com metas RPO/RTO aprovadas.

Não foram criadas TASK-036, feature, migration ou alteração de produto. Não houve
deploy, publicação, alteração remota, uso de credenciais reais ou acesso a dados
de pacientes.

## Resultado da TASK-035 e evidências desta revisão

TASK-035 informou que lint, typecheck, testes unitários/integração, migrations
descartáveis, browser E2E mockado, build e dependency audit passaram. As suites
separadas cobriram webhook/ingress, scheduling, mensagens, worker, Calendar,
dashboard, tenant isolation e segurança. O browser E2E não iniciou API e registrou
`ECONNREFUSED` em `/realtime`; portanto não demonstrou a UI conectada. Não houve
falha de teste, migration pendente ou advisory conhecido naquela rodada.

Nesta revisão, um PostgreSQL 17 com filesystem efêmero recebeu as 35 migrations.
Foi criado um tenant sintético, feito dump custom, restaurado em um database
isolado e confirmado que a linha sintética permaneceu presente. O container foi
removido. Isso valida o mecanismo básico de dump/restore local e o schema atual;
não mede duração, RPO/RTO nem cópia externa.

Foram revisados `.env.example`, configuração de worker/health e disponibilidade de
ferramentas: `gitleaks` e `trufflehog` não estão instalados. Um `.env` local existe,
está fora do Git e não foi lido nem usado nesta validação; portanto não se afirma
que seus valores sejam seguros ou adequados para produção. A revisão textual
anterior encontrou somente a fixture de teste `sk-test-only-not-a-real-key`; ela
não certifica o histórico Git. A consulta anterior ao GitHub não encontrou runs
visíveis; proteção de branch não foi comprovada. Não foram usadas credenciais de
provider para testar integração real.

## Pendências com estado inequívoco

| Achado                                                                                  | Estado       | Evidência / condição para fechar                                                                                       |
| --------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Acceptance conectado inbound → engine → Appointment → audit/outbox → Calendar/dashboard | **BLOCKING** | Suites passam separadamente; falta uma execução conectada correlacionada e o smoke em staging.                         |
| WhatsApp, AI, HTTPS e deployment com providers reais                                    | **BLOCKING** | Sem staging, domínio ou credenciais de teste. Executar callback, envio/retorno, retry e fallback com dados sintéticos. |
| Backup externo e metas RPO/RTO                                                          | **BLOCKING** | Restore local sintético passou; responsável ainda deve configurar cópia externa, aprovar metas e medir restore.        |
| Runtime de produção Web/API/Worker                                                      | **BLOCKING** | Dockerfile/Compose são dev-only. Validar artefatos/tipologia imutáveis e rollback antes do deploy.                     |
| CI remota e proteção de branch                                                          | **BLOCKING** | Nenhum run/configuração foi observado; workflow verde obrigatório no commit candidato.                                 |
| OAuth/refresh Google Calendar                                                           | **DEFERRED** | Apenas se Calendar ficar `DISABLED`; vira BLOCKING antes de ativar.                                                    |
| Redaction/correlação API → worker                                                       | **BLOCKING** | Provar logs sem mensagem, telefone, dado clínico ou segredo, com retenção e operador definidos.                        |
| Browser E2E com API e sessão reais                                                      | **BLOCKING** | Rodar smoke de UI em staging; os 25 casos anteriores usam mocks.                                                       |
| SIGTERM/restart e outage com job ativo                                                  | **DEFERRED** | Restrito a uma clínica, operador acompanha worker/failed jobs; bloquear expansão até ensaio completo.                  |
| Scanner dedicado no histórico Git                                                       | **BLOCKING** | Ferramenta indisponível localmente; executar scanner no histórico/branch antes de inserir segredos reais.              |
| Load budget e rate limit multi-instância                                                | **DEFERRED** | Somente uma instância e tráfego pequeno; medir antes de escalar horizontalmente.                                       |

Os estados e ações estão detalhados em [MVP-KNOWN-ISSUES.md](MVP-KNOWN-ISSUES.md).
Os itens deferred são condicionais e não autorizam escala ou ativação de Calendar.

## Segurança, isolamento e fluxo

As evidências locais da TASK-035 para autenticação, RBAC, tenant scope,
Tool Gateway fechado, validação de webhook/HMAC, idempotência, MFA de Super Admin,
sanitização e audit permaneceram aprovadas. Também passaram testes cross-tenant de
HTTP/repository, realtime, tools e dashboard. Nenhum código de autorização ou
tenant-scoped foi alterado nesta revisão, então essas regressões não foram
reexecutadas.

O fluxo de negócio tem cobertura de integração por partes: WhatsApp persiste
ingressos; Conversation Engine e Tool Gateway exercitam scheduling; appointment,
outbox/notification, Calendar e dashboard possuem testes próprios. Como não há
aceite único conectado e UI/API real, o fluxo completo permanece BLOCKING para
piloto. Nenhuma afirmação de provider real foi feita.

## Worker e recuperação

Suites anteriores cobrem retry, idempotência, concorrência, Redis/outbox recovery,
reconciliação Calendar, expiração de HOLD e handlers SIGTERM. Não foi ensaiado um
processo real encerrado durante efeito externo com verificação da cadeia completa;
por isso crash/shutdown fica DEFERRED somente para escala pequena e com operador
presente. O worker executa expiração de HOLD, SLA, mensagens, notification e
Calendar; desligá-lo pausa todas essas funções. PostgreSQL guarda a fonte de
verdade; não apagar ledgers nem fazer replay manual sem checar idempotência.

## Integrações e configuração de piloto

WhatsApp e OpenAI não podem ser ativados até o teste sintético em staging. Google
Calendar pode permanecer `DISABLED` e, nesse caso, OAuth é deferred. Fakes de teste
não são evidência operacional. Variáveis obrigatórias e condicionais, smoke,
observabilidade, kill switches e rollback estão em
[MVP-PILOT-CHECKLIST.md](MVP-PILOT-CHECKLIST.md). `.env.example` contém nomes e
valores vazios/de desenvolvimento; secrets reais devem vir do secret manager.

## Validação executada

- PostgreSQL 17 descartável: migrations, dump custom, restore para database novo e
  verificação de tenant sintético — **PASS**.
- Prisma schema: `pnpm db:validate` — repetir na validação final desta revisão.
- Formatação dos documentos e `git diff --check` — repetir na validação final.
- Lint, typecheck, unit, integração completa, browser E2E e build: não repetidos,
  pois nenhuma linha de código/teste/runtime foi alterada nesta revisão. Permanecem
  os resultados PASS reportados pela TASK-035, com os limites acima.
- `pnpm audit`: sem advisory conhecido na TASK-035; não repetido (sem mudança de
  dependências).
- Secret scan: revisão textual anterior limitada; scanner dedicado/histórico
  indisponível, e `.env` local não lido, portanto o gate não passou.
- Migrations persistentes: nenhuma. Nenhum banco fora do container temporário foi
  tocado.

## Arquivos desta revisão

- Criados: `docs/release/MVP-PILOT-CHECKLIST.md`,
  `docs/release/MVP-FINAL-STATUS.md`.
- Atualizados: `docs/release/MVP-KNOWN-ISSUES.md`,
  `docs/exec-plans/MVP-pilot-readiness.md`.
- Código, testes e schema: sem alterações nesta revisão.
- Migrations novas: nenhuma.

O checkout contém muitas mudanças anteriores não relacionadas nesta atividade;
preservá-las e revisar antes de commit. Não foi criado commit nem tag.

## Próximo gate de go/no-go

Uma pessoa responsável pela operação deve fornecer ambiente de staging e contas
sintéticas e concluir todos os itens BLOCKING da tabela, incluindo restore externo,
secret scan, CI/proteção e smoke conectado. Até lá, não enviar mensagens para
usuários externos nem inserir dados de paciente.

**MVP NOT READY FOR PILOT**
