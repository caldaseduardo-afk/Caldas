# TASK-029 — Google Calendar Provider

## Objetivo

Sincronizar consultas do PostgreSQL com um calendário Google configurado por tenant,
por meio de uma abstração `CalendarProvider` e jobs assíncronos idempotentes. A
consulta interna continua sendo a fonte de verdade: indisponibilidade ou erro do
Google nunca desfaz criação, alteração, cancelamento ou remarcação já confirmada no
backend.

## Escopo

- Criar a abstração `CalendarProvider` e a implementação
  `GoogleCalendarProvider` para testar conexão, localizar, criar, atualizar e
  cancelar eventos.
- Configurar uma integração Google Calendar por tenant, com `calendar_id`, status e
  referência de credenciais. Tokens e segredos não serão persistidos no banco.
- Marcar consultas como `PENDING` no mesmo commit da mutação interna quando houver
  integração ativa; sem integração, manter `NOT_REQUIRED`.
- Processar criação, atualização, cancelamento e remarcação no worker com BullMQ.
- Persistir ciclos/tentativas de sincronização no PostgreSQL e usar payloads mínimos
  (`tenantId`, `appointmentId`, `revision`) na fila.
- Reconciliar consultas futuras `PENDING`/`ERROR` em lotes e dentro de horizonte
  configurável.
- Registrar estado operacional, erro técnico sanitizado, número de tentativas,
  última sincronização e auditoria sem credenciais ou dados clínicos.
- Adicionar configuração e consulta administrativa mínima da integração, protegidas
  por RBAC existente, além de teste de conexão.
- Cobrir isolamento entre tenants, idempotência, concorrência, retry, recuperação
  após criação externa e minimização de dados.

## Fora de escopo

- Sincronização Google → PostgreSQL, webhooks do Google ou importação de eventos.
- Uso do Google Calendar como fonte de disponibilidade ou prevenção de conflito.
- OAuth interativo completo e tela de consentimento; o MVP resolve uma credencial
  previamente provisionada por uma referência de ambiente.
- Integrações Outlook, Apple ou calendário interno adicional.
- Convites/attendees, dados clínicos, notas livres da consulta ou dados do paciente
  no evento externo.
- TASK-030 e posteriores.

## Decisões técnicas

1. `CalendarIntegration` será uma entidade tenant-scoped própria. A `Integration`
   existente representa o canal WhatsApp e possui campos obrigatórios específicos
   (`phone_number_id` e `external_account_id`); ampliar essa tabela nesta tarefa
   enfraqueceria suas invariantes. Cada tenant terá no máximo uma configuração
   Google Calendar.
2. A configuração será tenant-level e apontará para um calendário compartilhado.
   Mapeamento de calendário por profissional não é necessário no backlog atual e
   fica preparado pela abstração do provider, sem ser antecipado no schema.
3. `credentials_reference` identifica um conjunto de variáveis de ambiente. O
   resolvedor recebe client id, client secret e refresh token fora do banco, troca o
   refresh token por access token e nunca registra os valores. O escopo esperado é o
   mínimo de eventos de calendário.
4. A `Appointment` ganhará `calendar_sync_revision`,
   `calendar_sync_attempts`, `calendar_sync_error_code` e
   `calendar_last_synced_at`. Cada mutação relevante incrementa a revisão e define
   `PENDING` quando a integração está ativa. Resultado de uma revisão antiga não
   sobrescreve uma revisão mais nova.
5. `CalendarSyncAttempt` será o ledger durável e terá unicidade por tenant,
   appointment e revisão. O `jobId` BullMQ deriva desses três valores. Redis é
   transporte; PostgreSQL contém a intenção e permite reconstrução após perda da fila.
6. O worker recarrega e valida tenant, consulta, integração e revisão. O payload da
   fila nunca escolhe credencial, calendário, horários ou conteúdo do evento.
7. O evento Google terá título administrativo genérico com o nome do serviço,
   início/fim em UTC e timezone IANA da unidade/tenant, localização administrativa
   da unidade, sem paciente, telefone, notas, attendees ou informação clínica.
8. A propriedade privada `extendedProperties.private.appointmentId` identifica a
   consulta. Antes de criar, o provider busca essa propriedade; isso recupera o
   `external_event_id` se houver crash depois da criação externa e antes do commit.
9. Cancelamento usa `events.delete`. `404/410` em consulta cancelada é sucesso
   idempotente; em consulta ativa, evento ausente é recriado. Alteração e remarcação
   usam update do evento existente, ou criação idempotente se ele desapareceu.
10. Timeouts, `429` e `5xx` são transitórios e usam backoff exponencial limitado.
    Credencial inválida, permissão negada e configuração inválida são erros
    permanentes e não entram em retry infinito. A reconciliação pode reabrir `ERROR`
    somente dentro do limite configurado de tentativas.
11. A reconciliação usa paginação, horizonte futuro e índices tenant/status/tempo.
    Consultas canceladas com evento externo também são elegíveis até concluírem o
    cancelamento; consultas ativas futuras são conciliadas.
12. O `CalendarProvider` não acessa Prisma. O serviço de sincronização prepara um
    comando mínimo, o provider executa HTTP e o serviço persiste o resultado.

## Arquivos afetados

- `packages/domain/src/calendar-provider.ts` e exports do pacote de domínio.
- `packages/database/prisma/schema.prisma` e nova migration da TASK-029.
- `packages/database/src/calendar-*.ts`, exports e testes unitários/de integração.
- `apps/api/src/appointments/*` para registrar intenção de sync no mesmo commit.
- `apps/api/src/calendar-integrations/*`, `app.module.ts` e testes administrativos.
- `apps/worker/src/main.ts`, testes do worker e variáveis de ambiente documentadas.
- `.env.example`, `README.md` e documentação de integrações/arquitetura somente onde
  a decisão operacional precisar ser registrada.

## Mudanças de banco

- Adicionar `CalendarIntegration` com tenant obrigatório, provider Google, calendar
  id, referência de credenciais, status e timestamps de validação/erro.
- Adicionar `CalendarSyncAttempt` com tenant, appointment, revisão, operação, estado,
  contagem, correlação, erro sanitizado e timestamps.
- Acrescentar metadados de revisão e diagnóstico de sync à `Appointment`, preservando
  os campos já existentes `calendar_provider`, `external_event_id` e `sync_status`.
- Criar foreign keys compostas tenant-scoped, checks de coerência e índices para
  integração ativa, reconciliação por status/data e ledger por revisão.
- Não alterar migrations históricas.

## Riscos e mitigação

- **Duplicação após crash:** busca por propriedade privada da consulta antes da
  criação e unicidade do ledger por revisão.
- **Resultado antigo sobrescrever alteração nova:** updates condicionados à revisão
  corrente.
- **Rate limit/indisponibilidade:** timeout, classificação de erro, retry limitado e
  reconciliação pelo PostgreSQL.
- **Vazamento de dados:** event builder com allowlist, sem nome do paciente/notas, e
  logs estruturados apenas com identificadores técnicos.
- **Credencial revogada:** erro permanente/degraded, teste de conexão e Appointment
  preservada.
- **Jobs cross-tenant:** todas as leituras e escritas usam tenant + id e revalidam a
  relação com a integração.

## Testes

- Contrato do `CalendarProvider`, composição segura do evento e timezone.
- Google provider com HTTP simulado: token, testConnection, lookup, create, update,
  delete, timeout, `404/410`, `429`, `5xx`, autenticação e sanitização de erros.
- Criação, alteração, cancelamento e remarcação deixam intenção durável correta.
- Sem integração resulta em `NOT_REQUIRED`; integração ativa resulta em `PENDING`.
- Job idempotente, concorrência, revisão obsoleta, retry transitório e falha
  permanente.
- Recuperação após criação externa sem `external_event_id` local.
- Reconciliation em lotes/horizonte, incluindo canceladas e isolamento por tenant.
- RBAC e endpoints de configuração/status/teste sem exposição da credencial.
- E2E obrigatório: criar → criar evento; alterar/remarcar → atualizar evento;
  cancelar → remover evento; repetir jobs sem duplicar.
- E2E de crash: evento existe pela propriedade privada, processamento recupera o id
  e conclui sem segunda criação.

## Comandos de validação

```bash
pnpm db:validate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm --filter @atendente/worker test
pnpm build
```

## Critérios de aceite

- PostgreSQL permanece fonte de verdade e mutações internas funcionam com Google
  indisponível.
- Operações externas são assíncronas, idempotentes, tenant-scoped e recuperáveis.
- Criação, atualização/remarcação e cancelamento convergem para o estado interno.
- Estados `NOT_REQUIRED`, `PENDING`, `SYNCED` e `ERROR` refletem a sincronização e
  expõem diagnóstico seguro.
- Falhas transitórias têm retry limitado; falhas permanentes não geram loop infinito.
- Nenhum segredo, dado clínico, paciente, telefone ou nota é enviado ao evento/log.
- Testes, migration, lint, typecheck e build passam sem implementar TASK-030.

## Rollback

Desativar a integração interrompe novas intenções e mantém consultas como
`NOT_REQUIRED`; pausar dispatcher/worker preserva as intenções existentes no banco.
Os eventos já sincronizados podem ser conciliados antes da desativação. Remoção de
colunas/tabelas exige migration compensatória posterior e preservação do ledger para
auditoria; migrations históricas não serão editadas.
