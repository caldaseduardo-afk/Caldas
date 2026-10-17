# Dashboard da clínica — TASK-031

## Definições das métricas do Dashboard

O endpoint retorna um snapshot consistente do tenant ativo. Todos os números são
agregados no backend/PostgreSQL; o navegador apenas formata e desenha as séries.
Não há chamadas à IA, dados de pacientes, conteúdo de mensagens ou métrica global.

### Período, timezone e filtros

GET `/analytics/dashboard?period=LAST_30_DAYS` aceita TODAY, LAST_7_DAYS,
LAST_30_DAYS, THIS_MONTH, LAST_MONTH e CUSTOM. CUSTOM exige `from` e `to` no formato
YYYY-MM-DD (anos 2000–2100; até 366 dias inclusivos). Demais presets rejeitam datas.
Últimos 7/30 dias incluem hoje; este mês inclui o mês civil inteiro, inclusive agenda
futura. Datas retornadas são civis inclusivas, convertidas para intervalo UTC
`[startAt, endAt)`, com endAt no início do dia seguinte a `to`.

Timezone = Unit.timezoneOverride quando unitId foi selecionado, senão Tenant.timezone.
Todos os gráficos e métricas do snapshot usam esse timezone. Presets usam o relógio
PostgreSQL e calendário IANA; conversão de bordas usa PostgreSQL AT TIME ZONE. Em
transições DST, um dia pode ter 23/25h: não somar 24h ao instante inicial. Meia-noite
inexistente segue a resolução PostgreSQL para o primeiro instante após o salto;
horas ambíguas seguem a resolução PostgreSQL (offset padrão). O navegador não define
limites nem envia timezone. Testes incluem São Paulo e New York/DST.

Unit, Service e Provider são filtros opcionais por UUID, validados no tenant com
404 indistinguível para recurso inexistente/externo. Afetam agenda, origens, série
de consultas e rankings. Conversas, SLA e conversão continuam abrangendo toda a
clínica, no mesmo intervalo/timezone; a interface informa essa diferença.

### Agenda (por start_at)

Universo U = Appointments do tenant e filtros com start_at no intervalo, excluindo
status RESCHEDULED. Não é a contagem de consultas criadas no período. Canceladas
pertencem ao dia da realização originalmente prevista, não a cancelled_at.

| Indicador | Fórmula |
| --- | --- |
| Consultas agendadas | count(U), incluindo canceladas/no-show |
| Confirmadas | count(U com status CONFIRMED, CHECKED_IN ou COMPLETED) |
| Cancelamentos | count(U com status CANCELLED) |
| No-show | count(U com status NO_SHOW) |
| Taxa de confirmação | 100 × confirmadas / count(U sem CANCELLED) |
| Taxa de cancelamento | 100 × canceladas / count(U) |
| Taxa de no-show | 100 × NO_SHOW já iniciadas / (COMPLETED + NO_SHOW já iniciadas) |
| Origem | count(U) por source: WHATSAPP_AI, WHATSAPP_HUMAN, WEB, PHONE, MANUAL, IMPORT |

Taxas são percentuais com até duas casas, denominador zero retorna 0. Confirmação
mede status atual, não prova histórica: NO_SHOW não entra no numerador. No-show usa
somente start_at <= generatedAt, não consultas futuras. Consultas pendentes/passadas
sem desfecho COMPLETED/NO_SHOW não integram esse denominador. Não deduzir presença.

Série diária tem a mesma base/filtros e as mesmas fórmulas dos cards. Somar contagens
diárias reproduz o resumo; taxas diárias não se somam. Dias vazios recebem zeros.
Rankings usam U, top 5 por Service/Provider/Unit, count descendente, nome e ID como
desempate estável. O painel de unidades é omitido quando há apenas uma unidade com dados.
Top 5 unidades é ranking limitado, não distribuição completa
quando há mais de cinco unidades; pode omitir a cauda. Não há ranking entre tenants.

### Conversas e distribuição de atendimento

- Conversas no período: count DISTINCT conversation_id das Messages criadas no
  intervalo. Várias mensagens ou dias não duplicam o total.
- Série de conversas: DISTINCT por dia; uma conversa em dois dias participa de ambos.
  Por isso sua soma diária pode superar o total distinto do período (rótulo explícito).
- Messages total, AI e USER: volume por sender_type, independente de status atual.
  PATIENT/SYSTEM entram só no volume total. Não confundir mensagem IA com AI_ACTIVE.
- Handoffs: número de HUMAN_HANDOFF_REQUESTED auditados no intervalo; repetição de
  ciclos é válida. A série agrupa esses eventos pelo mesmo dia local.
- Agora: contagens atuais por AI_ACTIVE, WAITING_PATIENT, NEEDS_HUMAN, HUMAN_ACTIVE,
  RESOLVED e CLOSED, sem corte temporal. IA x humano usa estados separados, sem
  percentual misturando mensagens com conversas.

### SLA e resposta humana

- Aguardando agora: status NEEDS_HUMAN.
- FIRST/SECOND/EXTERNAL agora: contagens de NEEDS_HUMAN pelo slaLevel persistido.
  São níveis mutuamente exclusivos. Nenhum limiar é recalculado no dashboard;
  atraso do worker pode atrasar o nível exibido.
- Média para assumir: avg(claimedAt − requestedAt), em segundos, dos HumanSlaCycle
  com claimedAt no período. É equivalente à primeira atribuição menos solicitação
  daquele ciclo; não usar assignedAt atual após uma transferência. Só claimedAt
  preenchido e não anterior a requestedAt; sem amostras retorna null/“Sem dados”.
- Cada novo ciclo é uma amostra independente; ciclos abertos/encerrados sem claim
  ficam fora da média. Handoffs sem regra SLA não criam ciclo e não entram na média.
- Violações: count DISTINCT cycleId dos eventos HUMAN_SLA_FIRST_ALERT,
  HUMAN_SLA_SECOND_ALERT e HUMAN_SLA_EXTERNAL_ALERT_REQUIRED criados no período.
  Vários níveis no mesmo ciclo contam uma violação. Usa alertas reais auditados,
  não processamentos de job (que podem representar invalidação). Eventos legados
  sem cycleId não permitem deduplicação confiável e ficam fora da contagem.

### Conversão em agendamento

Denominador = eventos SCHEDULING_WORKFLOW_STARTED de workflowType SCHEDULING
iniciados no período. Eventos legados sem workflowType usam SCHEDULING, único tipo
anterior à TASK-025. Cada STARTED abre um ciclo até o próximo STARTED do mesmo
resourceId/tenant, inclusive quando o próximo muda para cancelamento/remarcação.

Numerador = esses ciclos com SCHEDULING_WORKFLOW_COMPLETED dentro do ciclo e vínculo
appointmentId para uma Appointment real do mesmo tenant com source WHATSAPP_AI.
EXISTS conta no máximo uma conclusão por início. A conclusão pode ocorrer após o
período selecionado: é conversão da coorte de inícios observada até o snapshot atual.
Taxa = 100 × numerador / denominador (zero quando não há inícios).

Abandono/expiração não convertem; Appointment manual não converte. Workflow atual
não serve como ledger porque é reutilizado e apaga o resultado do ciclo anterior.
Nenhum texto de paciente é analisado. Histórico sem eventos não é reconstruído.
Funil de pesquisa/HOLD omitido: não há trilha uniforme de etapas históricas por ciclo.

## API, segurança e desempenho

- GET `/analytics/dashboard`: resposta agregada, intervalo resolvido, generatedAt,
  filtros, agenda/séries, conversas, estados atuais, SLA, conversão e rankings.
- GET `/analytics/dashboard/options?kind=unit|service|provider&page=1&search=...`:
  IDs/nomes apenas, 25 por página + hasMore, busca limitada a 100 caracteres; inclui
  cadastros inativos para permitir consulta histórica. Nada de models completos.
- analytics.view já existe e pertence a CLINIC_ADMIN. Guards e service validam;
  repository revalida sessão/vínculo/role/tenant dentro de RepeatableRead antes das
  queries. Cada SELECT/CTE/join de negócio restringe tenant dentro do SQL. Sem bypass
  SUPER_ADMIN, sem confiança em tenantId recebido (DTO estrito o rejeita).
- Snapshot tem aproximadamente 10 consultas internas + até 3 para validar filtros,
  além da autorização dos guards/services. O número não cresce com cards, resultados
  ou quantidade de cadastros. Opções são três requests paginados independentes.
- Prisma.sql parametriza UUIDs, datas, timezone e filtros. SQL é usado para GROUPING
  SETS, contagens condicionais, DISTINCT, datas locais e conversão histórica; Prisma
  aggregate sozinho não representa essas operações sem multiplicar consultas.
- Backend recebe só grupos diários limitados pelo período e rankings top 5; não
  carrega todos os Appointments/Messages. Sem N+1 de nomes: joins no ranking.
- Sem cache, materialized view, tabela de métricas ou índice por cada combinação.
  Novos índices: appointments(tenant_id,start_at), messages(tenant_id,created_at),
  human_sla_cycles(tenant_id,claimed_at) e
  auth_events(tenant_id,resource_id,type,created_at,id), este último para localizar
  próximo início/conclusão de cada ciclo sem varrer repetidamente o histórico.
  Demais índices de tenant/status/recurso/ação
  já existem. Não alterar migrations anteriores.
- Leitura não gera auditoria de negócio. Resposta nunca inclui Patient, Contact,
  CPF, telefone, conteúdo, prompts ou tokens. Frontend usa texto React escapado.

## Interface

`/dashboard` oferece presets/custom, opções pesquisáveis/paginadas, botão aplicar/
atualizar, cards com fórmulas, séries SVG com legendas/tooltips e tabela acessível,
origens e rankings. Alterar filtros só aplica após botão; atualização mantém seleção.
Resultados antigos são removidos em erro/403. Sem dados produz zeros/mensagem,
sem NaN. Não há drill-down ou WebSocket novo; desktop/notebook usam grid responsivo.
Não há biblioteca de gráficos prévia: SVG evita dependência nova. Tabela diária
é limitada pelo período (366 linhas), com scroll; cadastros usam paginação real.
