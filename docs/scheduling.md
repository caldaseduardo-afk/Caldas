# Agenda e Agendamentos

## 1. Regra principal

O backend calcula disponibilidade.

A IA apenas solicita opções.

## 2. Geração de slots

Para buscar horários:

1. identificar serviço;
2. determinar duração;
3. localizar profissionais aptos;
4. carregar disponibilidade recorrente;
5. aplicar exceções;
6. excluir conflitos;
7. considerar buffers;
8. considerar HOLDs;
9. aplicar unidade;
10. retornar opções.

## 3. HOLD

Ao escolher um horário:

1. criar HOLD;
2. bloquear slot temporariamente;
3. solicitar confirmação;
4. converter em consulta após confirmação;
5. expirar automaticamente se não confirmado.

Tempo padrão sugerido: 5 minutos.

Deve ser configurável.

## 4. Concorrência

Dois pacientes não podem obter o mesmo slot.

A criação do HOLD deve possuir proteção transacional/lock apropriado.

## 5. Confirmações

Regra:

```text
target = appointment_start - offset
```

Depois validar:

- janela horária;
- dias permitidos;
- tempo mínimo restante;
- política para fora da janela.

Políticas:

- PREVIOUS_ALLOWED_TIME
- NEXT_ALLOWED_TIME
- SKIP

## 6. Exemplo

Consulta: terça 08:00  
Offset: 4h  
Target: terça 04:00  
Janela: 08:00–20:00  
Policy: PREVIOUS_ALLOWED_TIME

Resultado: segunda 20:00.

## 7. Retry

Retries respeitam a mesma janela.

Nunca enviar automaticamente às 23h apenas porque o intervalo configurado foi 4 horas.

## 8. Confirmação x lembrete

`CONFIRMATION`: espera resposta.

`REMINDER`: informativo.

## 9. Cancelamento

Políticas de cancelamento pertencem à clínica.

A IA nunca inventa exceção.

Se ação estiver fora da regra:

- bloquear;
- explicar de forma administrativa;
- oferecer handoff quando configurado.

## 10. Remarcação

Preservar relação entre consulta anterior e nova.

Não perder histórico.

## 11. Calendar sync

Criar/alterar consulta no PostgreSQL primeiro.

Sincronizar com calendário externo posteriormente.

## 12. Testes obrigatórios

- sobreposição;
- buffers;
- exceções;
- HOLD concorrente;
- expiração;
- timezone;
- confirmação fora da janela;
- retry fora da janela;
- remarcação;
- cancelamento;
- provider indisponível.

## Disponibilidade estrutural — TASK-011

AvailabilityRule contém um período semanal por linha, com weekday, provider/unit,
startTime/endTime locais, validFrom obrigatório e validUntil opcional inclusivo.
StartTime deve anteceder endTime; períodos atravessando meia-noite devem ser
representados em dias separados. Horários têm precisão de minuto, entre 00:00 e
23:59. Não há slots, duração de Service, buffers, HOLD ou Appointment nesta entrega.

getProviderAvailability(providerId,unitId,date) retorna date, timezone efetivo e
windows com start/end HH:mm. A data é civil na unidade (YYYY-MM-DD), não timestamp.
O backend obtém timezoneOverride da unidade ou timezone da clínica; não recebe
configuração de timezone do browser. Regras/horários usam DATE e TIME(0) sem zona,
e timestamps de auditoria usam UTC. A âncora UTC usada pelo adaptador Prisma para
transportar DATE/TIME não transforma horários locais em instantes UTC.

Em datas com mudança de DST, as janelas permanecem intervalos de relógio local.
O serviço não converte horários inexistentes/repetidos em instantes. Essa resolução
será obrigatória na composição futura de slots UTC; não há confirmação de horário
agendável nesta resposta. Alterar timezone da unidade muda o contexto local da
consulta, sem deslocar automaticamente os horários semanais cadastrados.

Algoritmo:

1. Validar sessão, tenant, RBAC e associação ProviderUnit.
2. Identificar weekday da data civil sem depender do timezone do processo.
3. Carregar regras ativas com validFrom <= date <= validUntil (null = sem fim).
4. Unir essas janelas com EXTRA_AVAILABILITY ativa da data.
5. Ordenar e fundir janelas sobrepostas ou contíguas.
6. Subtrair a união de BLOCK/VACATION/HOLIDAY/MEETING/OTHER ativos. Um bloqueio
   interno divide a janela em duas; intervalos são [start,end), sem duração zero.

Exceções sem ambos os horários bloqueiam o dia inteiro. Um único horário é inválido.
EXTRA_AVAILABILITY exige ambos os horários e funciona sem regra recorrente.
Bloqueios sempre prevalecem sobre extras; férias/feriado de dia inteiro eliminam
as janelas desse dia, inclusive extras. Feriados/férias são cadastros explícitos,
sem integração com calendário externo. Exceções inativas não participam.

Provider, Unit ou ProviderUnit inativos retornam windows vazio; vínculo inexistente
retorna 404. Ativar/criar configuração ativa exige vínculo ProviderUnit ativo.
Inativação de configuração continua permitida após inativar o vínculo, preservando
histórico. Sobreposição de regras ativas é proibida somente no mesmo tenant/provider/
unit/weekday quando validades inclusivas intersectam; períodos adjacentes e
validades disjuntas são permitidos. A garantia existe também no PostgreSQL (EXCLUDE).

## HOLD — TASK-012

AppointmentHold reserva temporariamente um intervalo, sem criar Appointment.
startAt/endAt representam atendimento; endAt é calculado por durationOverrideMinutes
de ProviderService ou durationMinutes de Service. occupiedStartAt/occupiedEndAt
preservam os buffers do Service no momento da reserva. A ocupação inteira deve
caber na disponibilidade estrutural. Intervalos são semiabertos [início,fim).

Entradas absolutas exigem RFC3339 com offset ou Z e precisão de minuto. Persistência
usa TIMESTAMPTZ/UTC. Cada minuto decorrido da ocupação é validado no timezone da
unidade/clínica; offsets distinguem horas repetidas em DST. Não há conversão de
horário local ambíguo pelo backend. Ocupações atravessando data civil são recusadas
nesta etapa, com limite de 26 horas.

Criação usa transação Serializable, lock de ProviderUnit compartilhado com a
configuração da disponibilidade e EXCLUDE GiST por tenant/provider/unit/ocupação
para ACTIVE. Expira vencidos sob a mesma transação antes de inserir. Portanto,
limpeza atrasada não bloqueia novas reservas. A política é por profissional/unidade;
bloqueio global do profissional entre unidades não está definido nesta etapa.

HOLD_TTL_SECONDS configura TTL (padrão 300 segundos), limitado ao início do
atendimento. O worker varre vencidos a cada HOLD_SWEEP_INTERVAL_MS (padrão 30000).
Leituras consideram expiresAt imediatamente. ACTIVE pode virar EXPIRED ou RELEASED;
estados encerrados não são reativados. CONSUMED existe somente para composição futura.
Criação, liberação e expiração possuem auditoria transacional.

POST exige requestId UUID único por tenant e vinculado ao criador. Retry do mesmo
payload retorna a reserva original sem renovar expiração; outra identidade/payload
recebe 409. Sem Conversation nesta etapa, não há conversationId sem integridade.

## Consultas — TASK-013

Appointment ocupa definitivamente a agenda. Criação direta e conversão de HOLD
iniciam PENDING_CONFIRMATION; confirmar é uma operação de estado autorizada.
PENDING_CONFIRMATION, CONFIRMED e CHECKED_IN bloqueiam; COMPLETED, CANCELLED,
NO_SHOW e RESCHEDULED permanecem históricos sem bloquear novos horários.

Transições: PENDING_CONFIRMATION -> CONFIRMED/CANCELLED/RESCHEDULED; CONFIRMED ->
CHECKED_IN/CANCELLED/RESCHEDULED/NO_SHOW; CHECKED_IN -> COMPLETED. CHECKED_IN e
NO_SHOW exigem início alcançado; COMPLETED exige fim alcançado. Terminais não
reativam. Não há tolerância/automação de confirmação nem política de antecedência
por clínica nesta etapa. Cancelamento repetido retorna o registro sem novo evento.

Conversão revalida o HOLD ACTIVE não vencido, relações, disponibilidade e conflitos,
consome e insere Appointment com holdId único na mesma transação Serializable.
Alteração de duração/buffers desde a reserva exige novo HOLD; não alterar horário
silenciosamente. Falha de criação ou auditoria reverte consumo. Retry de HOLD já
consumido recebe 409. A consulta mantém o snapshot de ocupação com buffers.

Criação direta e HOLD compartilham validação e conflito. PostgreSQL serializa pelo
ProviderUnit, EXCLUDE protege cada tabela e triggers consultam a outra tabela sob
o mesmo lock, inclusive para escrita SQL direta. ACTIVE vencido não bloqueia.
UTC, offsets explícitos, DST e limite de data local seguem a estratégia de HOLD.

Remarcação usa criação direta do novo horário: mantém Patient/Contact, permite novo
Provider/Unit/Service e cria sucessor com previousAppointmentId. O original vira
RESCHEDULED na mesma transação; falha preserva original. Unique impede bifurcação;
FK inclui tenant/paciente. Horários originais não são sobrescritos.

Todas as ações registram ator/tenant/recurso e transição em AuthEvent, sem copiar
notes/motivo clínico. cancellationReason/cancelledAt ficam no Appointment; ator do
cancelamento no evento atômico. Campos de calendário ficam nulos e syncStatus
NOT_REQUIRED, sem chamadas externas.

## Notification Rules — TASK-014

NotificationRule configura CONFIRMATION (espera resposta) ou REMINDER (informativo).
Múltiplas regras do mesmo tipo coexistem e calculam independentemente. Esta camada
persiste configuração e retorna SCHEDULE/instante UTC ou SKIP/motivo; não envia,
registra tentativas, interpreta resposta, executa ações ou cria jobs.

Alvo inicial = appointmentStart - offsetMinutes. Retry = previousAttemptAt +
retryAfterMinutes. Os dois usam o mesmo resolvedor de janela e dias. Horários locais
têm precisão de minuto e a janela inclui ambas as bordas: 08:00–20:00 permite 20:00.
Esta é uma janela de comunicação, distinta dos intervalos semiabertos de ocupação.

Timezone efetivo = Unit.timezoneOverride ou Tenant.timezone. Intl aplica as regras
IANA sobre instantes UTC; nenhum offset fixo nem timezone do browser. Busca limitada
a 9 dias em passos de minuto, numa só direção: PREVIOUS_ALLOWED_TIME busca anterior,
NEXT_ALLOWED_TIME posterior, SKIP não ajusta. Dia proibido fecha toda a janela desse
dia e a busca continua em outros dias. Em DST, instantes inexistentes não são criados
e horas repetidas são resolvidas pelo instante mais próximo na direção da política.

Exemplo: terça 08:00 em America/Sao_Paulo, offset 240, janela08–20 e PREVIOUS resultam
em segunda20:00 (23:00Z no exemplo de outubro/2026). NEXT encontra terça08:00, mas
retorna SKIP/AT_OR_AFTER_APPOINTMENT. Mesmo mínimo zero não permite envio no início
ou após a consulta. Antecedência exatamente igual ao mínimo é permitida.

maxAttempts significa tentativas totais, incluindo a inicial. attemptNumber=2 é o
primeiro retry; número acima do limite retorna MAX_ATTEMPTS. Retry desabilitado
retorna RETRY_DISABLED. Todo retry reaplica janela, dias e mínimo. PREVIOUS pode
antecipar o alvo teórico, mas deve ficar estritamente após previousAttemptAt; caso
contrário retorna NON_FORWARD_RETRY. Não trocar silenciosamente para NEXT.

active=false retorna INACTIVE_RULE. Configuração inválida falha fechada. Cálculos
são teóricos/determinísticos, inclusive para datas históricas; não usam Date.now.
O executor futuro deverá verificar atualidade, resposta, estado e deduplicação.
Cálculo por Appointment encerrado ou CHECKED_IN retorna APPOINTMENT_INACTIVE.

actionIfNoResponse default NONE; MARK_UNCONFIRMED, NEEDS_HUMAN e CANCEL_APPOINTMENT
são intenções apenas. Não há cancelamento automático. Retry e ação persistidos não
transformam REMINDER em confirmação: a interpretação de ausência de resposta é
responsabilidade da automação futura. Preview chama o mesmo motor operacional.

## Busca administrativa de slots — TASK-022

SchedulingService/Repository compõem os helpers existentes: ProviderService (override de
duração), buffers de Service, ProviderUnit ativo, AvailabilityRule/ScheduleException,
Appointment PENDING_CONFIRMATION/CONFIRMED/CHECKED_IN e HOLD ACTIVE não expirado.

Entrada startAt/endAt são instantes ISO explícitos com offset e precisão de minuto.
Intervalo máximo 7 dias, limit 1–20; providerId/unitId são filtros opcionais. No máximo
20 combinações elegíveis (acima disso exigir filtro) e 2000 conflitos de cada tipo por
combinação (acima disso exigir intervalo menor). Catálogo inativo não gera resultado.
Passo de busca de 15 minutos a partir do início informado; não é enumeração de todo
minuto disponível. Datas de validade/exceções são civis no timezoneOverride da unidade
ou timezone da clínica; iteração em instantes reais não inventa horários durante DST.
Buffers precisam caber nas janelas estruturais. Resultado ordenado por instante, depois
provider/unit, contém IDs, startAt/endAt UTC e timezone, sem dados dos ocupantes.

Busca é informativa; `create_hold` chama o service existente que revalida e bloqueia
transacionalmente. Nenhum HOLD/Appointment é criado durante busca. Remarcação usa a
transação existente; não é cancelar + criar no gateway. `confirm_appointment` com holdId
reutiliza conversão para PENDING_CONFIRMATION; com appointmentId aplica CONFIRMED. O
resultado e a descrição do schema distinguem os dois casos, sem inferir confirmação textual.

## Agendamento conversacional — TASK-024

`SchedulingWorkflow` persiste uma sessão por Conversation. Patient, Service, filtros,
preferência civil, etapa, HOLD, Appointment, versão e expiração são estado do backend;
não são reconstruídos do histórico textual. `SchedulingSlotOption` persiste até cinco
opções numeradas com Service/Provider/Unit, instantes UTC e timezone. Responder “2”
seleciona essa linha; a IA não recompõe UUID ou horário.

As etapas críticas avançam somente com resultados reais do Tool Gateway. A busca usa
`search_available_slots`; a escolha inequívoca autoriza o payload exato de `create_hold`;
a confirmação explícita em `WAITING_CONFIRMATION` autoriza o payload exato de
`confirm_appointment`. Conversão usa a transação de Appointment existente, registra
origem `WHATSAPP_AI`, autoria `AI` sem usuário fictício e mantém `PENDING_CONFIRMATION`.

Preferência usa `YYYY-MM-DD` no timezone efetivo da unidade/clínica. MORNING é
06:00–12:00, AFTERNOON 12:00–18:00, EVENING 18:00–22:00 e ANY o dia civil inteiro.
O intervalo vira instantes antes da tool; a busca continua responsável por regras,
exceções, duração, buffers, Appointments e HOLDs. Horário local inexistente em DST é
rejeitado e folds escolhem deterministicamente o primeiro instante real.

Opções expiram após 15 minutos por padrão; workflow após 24 horas. O dispatcher marca
sessões vencidas sem HOLD ativo. HOLD mantém o TTL próprio. Recovery reconcilia HOLD
ativo, vencido/liberado, consumido e Appointment já criada. Handoff preserva o estado,
mas nunca renova a reserva. Mudança de Patient, Service, Provider, Unit ou slot libera
o HOLD anterior pela tool estreita `release_hold`.

## Cancelamento e remarcação conversacional — TASK-025

O workflow da TASK-024 também representa `CANCELLATION` e `RESCHEDULING`. A consulta
alvo fica em `targetAppointmentId`; a consulta criada ao concluir um agendamento ou uma
remarcação fica em `appointmentId`. `SchedulingAppointmentOption` persiste por tempo
limitado o mapa entre opções numeradas e consultas futuras do Patient/Contact já
autorizado. Apenas consultas `PENDING_CONFIRMATION` ou `CONFIRMED`, sem sucessora e
dentro do tenant atual, entram na lista. Quando há mais de uma, o backend exige a
seleção de uma opção persistida.

Cancelamento só executa `cancel_appointment` depois da etapa
`WAITING_CANCELLATION_CONFIRMATION`. O coordenador autoriza exatamente o UUID
persistido; o modelo não escolhe o recurso por texto livre. A Appointment é preservada
como `CANCELLED`, com a transição auditada e replay reconciliado pelo estado terminal.

Remarcação conserva Patient, Contact e Service da consulta original. A nova preferência
usa data civil e timezone efetivo da unidade/clínica, busca slots pelo motor existente e
cria um HOLD real. Durante busca e reserva, a consulta original continua válida. Somente
em `WAITING_RESCHEDULE_CONFIRMATION` o coordenador autoriza
`reschedule_appointment(appointmentId, holdId)`. A transação revalida autorização,
estado, vínculo, disponibilidade e buffers; depois marca a original `RESCHEDULED`,
consome o HOLD e cria uma sucessora com `previousAppointmentId`. Qualquer falha desfaz
as três alterações.

HOLD vencido ou liberado retorna o workflow à escolha de slot sem alterar a consulta.
Trocar a seleção ou abandonar libera uma reserva ativa. A unicidade de
`previousAppointmentId`, a transação serializável e o ledger do Tool Gateway impedem
duas sucessoras em retries ou confirmações concorrentes. O Conversation Engine recebe
somente projeções administrativas mínimas e continua sem acesso ao Prisma ou ao banco.

## Worker de notificações e manutenção — TASK-028

`NotificationAttempt` é o ledger durável de cada tentativa funcional. A identidade é
tenant + Appointment + NotificationRule + ciclo + número da tentativa. O ciclo deriva
do horário da consulta e da versão/configuração da regra; mudança de estado é sempre
revalidada no PostgreSQL e remarcação ou edição da regra invalida o ciclo anterior.

O dispatcher reconcilia consultas futuras em lotes, cria/upserta tentativas e publica
jobs determinísticos na fila BullMQ `appointment-notifications`. Redis é transporte:
se estiver vazio após restart, a reconciliação recompõe os jobs a partir do banco. O
processador carrega novamente Appointment, NotificationRule, tenant, Unit, Contact,
canal e Integration antes de persistir uma Message `PENDING` na outbox. O envio externo
continua no pipeline do `MessagingProvider`.

CONFIRMATION só atende `PENDING_CONFIRMATION`; REMINDER atende também `CONFIRMED`.
Estados encerrados, `CHECKED_IN`, regra inativa, ciclo obsoleto, canal ausente ou janela
inválida encerram a tentativa sem envio. Retry do BullMQ cobre falha técnica do mesmo
job. Retry funcional cria outro `NotificationAttempt`, reaplica timezone, janela,
weekdays, antecedência e `maxAttempts`, e nunca reutiliza uma decisão temporal vencida.

Horários locais usam `Unit.timezoneOverride ?? Tenant.timezone`; instantes agendados são
persistidos em UTC. `NONE` e `MARK_UNCONFIRMED` registram resultado sem inventar estado
de Appointment. `NEEDS_HUMAN` reutiliza o handoff/SLA existente de forma idempotente.
`CANCEL_APPOINTMENT` permanece apenas intenção registrada, conforme a política que
proíbe cancelamento automático sem confirmação.

O sweep de HOLDs continua separado, em batch e idempotente. Apenas `ACTIVE` vencido é
expirado; `CONSUMED` e `RELEASED` são preservados. O cálculo de disponibilidade já
ignora HOLD vencido mesmo antes do cleanup.
