# Conversas, IA e Atendimento Humano

## 1. Interface

Layout em três áreas:

```text
Lista de conversas | Conversa | Contexto
```

## 2. Lista

Mostrar:

- nome;
- última mensagem;
- status;
- responsável;
- tempo de espera;
- prioridade;
- tags.

Filtros:

- Todas
- Não lidas
- IA
- Humano
- Precisa humano
- Aguardando paciente

## 3. Painel de contexto

Mostrar:

- contato;
- telefone/canal;
- paciente ativo;
- vínculo;
- autorização;
- pacientes relacionados;
- próxima consulta;
- notas;
- tags.

## 4. Estados

- AI_ACTIVE
- WAITING_PATIENT
- NEEDS_HUMAN
- HUMAN_ACTIVE
- RESOLVED
- CLOSED

## 5. Intenções

- SCHEDULING
- RESCHEDULING
- CANCELLATION
- CONFIRMATION
- INFORMATION
- PAYMENT
- COMPLAINT
- CLINICAL_QUESTION
- OTHER

## 6. Handoff

Quando humano assume:

- registrar usuário;
- alterar estado;
- suspender respostas automáticas da IA.

Quando humano devolve:

- produzir resumo;
- atualizar estado;
- reativar IA.

## 7. Lock

Somente um atendente deve poder responder como responsável por vez.

Supervisor autorizado pode transferir.

## 8. Nota interna

Nunca enviar nota interna ao canal externo.

## 9. Resumo

O resumo é dado auxiliar.

Não substituir histórico original.

## 10. Mensagens

Persistir antes do processamento.

Todo evento recebido deve ser idempotente por `provider_message_id`.

## 11. Áudio

Pode ser transcrito.

Manter metadados e referência ao original conforme política de retenção.

## 12. SLA humano

Configuração por clínica:

- primeiro alerta;
- segundo alerta;
- alerta externo.

Fila deve mostrar tempo aguardando.

## 13. Motivos de handoff

- USER_REQUESTED_HUMAN
- AI_LOW_CONFIDENCE
- PAYMENT_NEGOTIATION
- COMPLAINT
- CLINICAL_QUESTION
- AUTHORIZATION_PROBLEM
- SCHEDULING_CONFLICT
- SYSTEM_ERROR
- OTHER

## Persistência inicial — TASK-015

Conversation é contexto Contact/tenant/canal; Patient ativo opcional não determina
identidade do falante nem concede autorização. Canal inicial WHATSAPP, sem provider
real; estado inicial AI_ACTIVE e intent OTHER não executam IA. Uma conversa aberta
por tenant/contact/channel é garantida por índice parcial. AI_ACTIVE, WAITING_PATIENT,
NEEDS_HUMAN e HUMAN_ACTIVE são abertas; RESOLVED/CLOSED históricas. Obter/criar reutiliza
a aberta; após resolução pode criar outra, sem reabrir a antiga.

Definir activePatientId exige vínculo ContactPatient ativo VERIFIED, FULL ou
SCHEDULING_ONLY, e patient.view. Troca de paciente mantém a mesma conversa. Leitura
contextual de paciente continua exigindo FULL em PatientAccessService a cada acesso;
nenhum dado clínico é expandido na resposta da conversa. ID histórico não autoriza.

Estados mínimos centralizados: AI_ACTIVE -> WAITING_PATIENT/NEEDS_HUMAN/RESOLVED;
WAITING_PATIENT -> AI_ACTIVE/NEEDS_HUMAN/RESOLVED; NEEDS_HUMAN -> HUMAN_ACTIVE;
HUMAN_ACTIVE -> AI_ACTIVE/WAITING_PATIENT/RESOLVED; RESOLVED -> CLOSED. CLOSED terminal.
NEEDS_HUMAN recebe motivo (default OTHER). Atribuição HUMAN_ACTIVE só existe como
operação interna autorizada, valida usuário/membro/role ativo e permissões de conversa.
Não há endpoint de assumir, lock/ownership ou motor de handoff. Sair HUMAN_ACTIVE limpa
responsável; retornar à IA exige conversation.transfer. Intent é independente e mutável
em conversas abertas. Encerradas recusam contexto, nova mensagem e reabertura.

Message é entidade própria. USER recebe senderUserId da sessão; PATIENT significa
Contact recebido, AI e SYSTEM possuem operações internas separadas sem falso usuário.
A API pública nunca aceita senderType/senderUserId/providerMessageId/createdAt. SYSTEM
é interno; nenhum tipo dispara envio nesta entrega. AI interno só persiste em AI_ACTIVE.

Ingresso PATIENT exige providerMessageId. Unique tenant/channel/providerMessageId
impede duplicatas (null permite mensagens internas independentes); channel também
compõe FK com Conversation. IDs repetidos em outro tenant coexistem. Payload/conversa
diferente sob a mesma chave recebe 409, sem expor a mensagem conflitante. A estratégia
assume um provider lógico por canal/tenant: múltiplas contas/providers exigirão ampliar
a chave antes da integração. Não há webhook nem autenticação de provider nesta task.

Persistência, lastMessageAt e auditoria são atômicos. Trigger PostgreSQL atualiza
lastMessageAt com o máximo de createdAt inserido, inclusive escrita SQL direta; API
serializa por Conversation antes de obter horário do banco. Retry idempotente não
avança lastMessageAt nem duplica auditoria. Só depois do commit a função interna retorna;
nenhum processamento por IA é chamado. Recibos internos de AI/USER respeitam
createdAt <= deliveredAt <= readAt <= agora; leitura implica entrega se ausente.
Recibos repetidos idênticos são idempotentes, divergentes rejeitados.

TEXT exige conteúdo; demais tipos suportam caption e metadata validada por tipo.
IMAGE/AUDIO/DOCUMENT usam mediaRef opaco e metadados limitados; LOCATION coordenadas;
CONTACT nome/telefone canônico; INTERACTIVE identificadores. Sem binário, transcrição,
resolução/download de anexos ou payload livre. Auditoria registra IDs/tipo/ator/campos,
sem copiar conteúdo/metadata.

Listas usam page/limit (default1/20, máximo100 e offset10000), items/hasMore. Mensagens
ordenadas createdAt/id ASC; conversas lastMessageAt DESC (nulos ao fim), createdAt/id
DESC. Offset não fornece snapshot estável durante novas inserções; evita histórico
ilimitado e prepara API para a TASK-016. Sem busca textual ou UI nesta etapa.

## Inbox Web — TASK-016

`/conversations?conversationId=UUID` identifica apenas a conversa; tenant continua
sendo o selecionado na sessão autenticada. A UI usa fetch cancelável, descarta
respostas antigas e desmonta histórico/contexto ao trocar de conversa ou clínica.
Não existe persistência de credenciais em localStorage.

Endpoints de leitura da inbox (todos exigem conversation.view + contact.view):

- `GET /inbox/session`: clínica/timezone e capacidades reais para a interface.
- `GET /inbox/conversations`: page/limit, status e q; ordenação lastMessageAt desc,
  createdAt desc, id desc, nulos por último. Busca nome, dígitos de telefone e
  paciente ativo antes da paginação. Busca por paciente exige patient.view.
- `GET /inbox/conversations/:id`: contato, vínculos ativos, paciente e próxima
  consulta PENDING_CONFIRMATION/CONFIRMED futura. Dados de paciente exigem
  patient.view; consulta também exige appointment.view. Sem dados clínicos.
- `GET /inbox/conversations/:id/messages`: limit (30 padrão, máximo 100) e before
  (ID de mensagem da mesma conversa/tenant). Cursor por createdAt + id; resposta
  crescente e cursor da primeira mensagem quando houver anteriores. Referências
  internas de mídia não são expostas nem convertidas em URL.

Resumo da lista inclui contato/canal principal, última mensagem, responsável e
paciente permitido, em consultas em lote. Não há chamadas por item no frontend.
Contexto limita vínculos ativos a 100, em ordem estável. Escritas reutilizam
PATCH /conversations/:id e POST /conversations/:id/messages da TASK-015, com
suas permissões, auditoria e validação do vínculo; não há novo fluxo de envio.

Datas de mensagens usam timezone da clínica. Próxima consulta usa override da
unidade ou timezone da clínica. Mensagens escapadas por React; autores identificados
por texto e tipos sem suporte binário apresentados como blocos legíveis. Nenhuma
URL de anexo é inventada. Não há não-lidas por operador nem estados novos de UI.

## Tempo real — TASK-017

A atualização manual da TASK-016 permanece disponível, agora acompanhada por uma
conexão WebSocket por janela/Workspace. Lista e conversa aberta recebem avisos de
alteração; o cliente relê as projections REST autorizadas, sem aplicar snapshots
recebidos pelo socket. Rascunho, seleção e histórico carregado permanecem durante
atualizações em background. Busca/filtros/página atual continuam determinando a
listagem. Nenhum contador de não lidas foi inventado.

Eventos publicados: `conversation.created`, `conversation.updated`,
`conversation.status_changed`, `conversation.assigned`,
`conversation.active_patient_changed`, `message.created`, `message.delivered` e
`message.read`. Alteração de paciente também gera updated; alterações correlatas
são agrupadas no frontend durante 100ms. Atribuição continua sendo operação interna
da TASK-015, sem assumir/transferir/handoff. Recibos são apenas os registros internos
existentes; não representam confirmação real de entrega ou leitura pelo WhatsApp.

Envelope: `{eventId, type, tenantId, conversationId, messageId?}`. Não contém texto,
metadata de mensagem, paciente, usuário atribuído, cookie ou segredo. O gateway
valida também IDs de conversa/mensagem antes de transmitir. O primeiro frame é
`{type: "realtime.ready", tenantId}`, confirmando o contexto autenticado da conexão.

Eventos são coletados na transação e publicados após commit pelo barramento interno.
Rollback/retry descarta a coleta anterior; repetição idempotente não republica.
O socket não aceita comandos/subscriptions e não persiste operações. Room equivalente
é um conjunto de conexões por tenant, preenchido exclusivamente a partir da sessão.

Cliente deduplica até 512 eventIds e mensagens por ID. Eventos fora de ordem apenas
provocam nova leitura do estado atual; nenhuma versão antiga é aplicada localmente.
Respostas REST obsoletas são abortadas/ignoradas. Histórico recente é combinado com
mensagens já carregadas quando há sobreposição; se houve lacuna maior que a página,
substitui pelo bloco recente e mantém cursor para recuperar anteriores, sem fingir
que o histórico está completo.

Queda mostra reconexão e mantém leitura/composição REST. Backoff exponencial com
jitter (750ms–30s), sem polling a cada segundo. Cada conexão autenticada provoca
ressincronização da lista/conversa ativa, inclusive na primeira conexão, cobrindo
alterações entre leitura inicial e assinatura. Troca de conversa não cria listeners
ou sockets; troca de clínica/logout desmonta a conexão e limpa estado. Cleanup
cancela tentativas e lotes pendentes, inclusive no Strict Mode do React.

MVP de instância única, entrega best-effort e sem replay/outbox. Falha entre commit
e publicação não perde o registro no banco; reconexão/atualização manual recupera.
Escritas SQL externas não publicam eventos de aplicação automaticamente.

## Handoff humano — TASK-018 (contrato vigente)

Esta etapa substitui a atribuição interna provisória da TASK-015. As operações
POST /conversations/:id/request-human, /claim, /transfer, /return-to-ai e /resolve
são explícitas. Request recebe `{reason}`; transfer recebe `{targetUserId}`;
as demais recebem corpo vazio. Ator vem exclusivamente da sessão. Status genérico
não executa transições de handoff, inclusive em chamadas internas. HUMAN_ACTIVE
não pode mais ir para WAITING_PATIENT: concluir exige devolver à IA ou resolver.

Request aceita AI_ACTIVE/WAITING_PATIENT, exige conversation.reply e grava motivo/
data; claim exige assign + reply e atribui a própria identidade. Transfer exige
transfer e valida alvo ativo, membro/role operacionais com conversation.view,
contact.view e conversation.reply. A permissão explícita autoriza transferir uma
conversa de outro responsável, inclusive para recuperação manual de usuário
inativado. Não há redistribuição automática. Return exige transfer e ownership;
resolve exige close e ownership. Todas exigem view/contact.view e tenant válido.

USER agora só persiste em HUMAN_ACTIVE e pelo responsável com reply. Não há
exceção por papel nem resposta administrativa sem transferência prévia. A mesma
transação que persiste a mensagem bloqueia a Conversation, serializando resposta
com transfer/return. canAiRespond é true somente para AI_ACTIVE; WAITING_PATIENT,
NEEDS_HUMAN, HUMAN_ACTIVE, RESOLVED e CLOSED suspendem AI. Persistência interna AI
usa a regra sob lock. A TASK-023 executa essa regra pelo Conversation Engine descrito
abaixo.

Claim usa transação Serializable, lock de escrita do registro e update condicionado
a status/responsável. Disputa entre dois usuários em instâncias diferentes tem
um sucesso e um 409. Repetir claim ou transfer para o responsável atual retorna
409, sem alterações/audit/eventos. Outros estados incompatíveis também dão 409;
sem permissão/ownership 403; recurso/alvo externo ou inexistente 404.

Somente HUMAN_ACTIVE tem responsável e assignedAt; somente NEEDS_HUMAN tem motivo.
Claim limpa o motivo corrente, preservando-o no audit. Return limpa responsável,
assignedAt, motivo e requestedAt; resolve limpa responsável/assignedAt/motivo,
registra resolvedAt e preserva requestedAt. Fechar preserva resolvedAt. Auditoria
registra ator real, tenant, conversa, anterior/novo responsável, motivo e instante.
Não há SYSTEM message nova nem resumo automático/manual nesta etapa.

GET /inbox/conversations?status=NEEDS_HUMAN é a fila paginada, ordenada por
handoffRequestedAt/id ASC. Demais filtros mantêm ordenação de última mensagem.
Projeções incluem motivo/data, responsável e paciente quando permitido, sem
histórico completo ou consultas HTTP por item. A UI mostra a data de entrada,
sem contador periódico, SLA ou alerta. GET /inbox/assignees?page=1&limit=20 exige
transfer e lista somente id/nome de alvos elegíveis no tenant.

Inbox mostra solicitar/assumir/transferir/devolver/resolver segundo capacidades do
backend. Composer exige responsável atual; conflito 409 relê o estado. Transfer é
visível também a outro operador com permissão explícita, permitindo recuperação.
Eventos existentes status_changed/assigned/updated são publicados após commit,
sem novo canal ou conteúdo sensível. Cada janela relê REST autorizado. As mesmas
limitações de entrega/barramento local da TASK-017 continuam válidas.

## SLA humano — TASK-019

HumanSlaRule é configuração única por clínica, administrada com settings.manage
por GET/POST /human-sla-rules, GET/PATCH /human-sla-rules/:id e
POST /human-sla-rules/:id/preview (`{requestedAt: instante ISO com offset}`).
Configuração recebe firstAlertMinutes, secondAlertMinutes, externalAlertMinutes,
internalAlertEnabled, externalAlertEnabled e active. Tempos são inteiros positivos
(até 525600 minutos), first < second; externo habilitado exige external > second.
Externo desabilitado admite null; interno desabilitado omite FIRST/SECOND.
Não existe configuração de minutos implícita nem criação automática de regra.

Entrada NEEDS_HUMAN cria ciclo UUID e jobs duráveis na mesma transação, se houver
regra ativa com algum alerta habilitado. O ciclo copia os tempos/flags: alterações
valem para ciclos novos. Desativar regra encerra ciclos em andamento e limpa alertas;
reativar não retoma ciclos encerrados. Conversas que já aguardavam sem regra não
recebem ciclo retroativo. Handoff sem SLA continua permitido.

A contagem começa em handoffRequestedAt, pelo relógio PostgreSQL, independentemente
de mensagens posteriores. Claim encerra ciclo, registra claimedAt e zera slaLevel
na mesma transação. Return/resolve também invalidam ciclos remanescentes. UUID e
endedAt impedem jobs antigos de afetar nova solicitação. RequestedAt/claimedAt
preservados no ciclo permitem medir primeira resposta sem confundir transferências.

Motor resolveHumanSlaLevel/humanSlaSchedule é compartilhado pelo worker e preview.
Alerta normal registra FIRST, SECOND ou EXTERNAL; NONE representa ausência de nível
ativo. Worker atrasado eleva diretamente ao maior nível vencido, marcando jobs
vencidos como processados. Não fabrica alertas retroativos intermediários: audit
registra previousLevel, nível efetivo, dueAt previsto e triggeredAt real. O histórico
permite distinguir atraso de execução da ultrapassagem de limites.

EXTERNAL gera HUMAN_SLA_EXTERNAL_ALERT_REQUIRED e externalSent=false. Não há
telefone de destino, provider ou envio nesta etapa. Destinatário deve ser configurado
junto da integração futura. Não confundir alerta requerido com entrega realizada.

Evento conversation.sla_updated usa envelope mínimo de IDs da TASK-017. QueueEvents
do BullMQ entrega retorno do worker ao barramento existente da API depois do commit;
claim/desativação publicam também depois do commit. Frontend relê REST autorizado.
Fila mantém FIFO, mostra nível por texto/cor e contador derivado de requestedAt,
atualizado localmente a cada 15 segundos. Não persiste contadores nem calcula
thresholds no frontend. Fora de NEEDS_HUMAN, nível/contador não aparecem.

## WhatsApp — TASK-020 (substitui limites de transporte das TASK-015/016/017)

Conversation tem integrationId imutável opcional. A política compartilhada de obter/criar
usa tenant/contact/channel/integration; vários números da mesma clínica não compartilham
a conversa aberta. Índice parcial separado mantém a unicidade legada com integrationId
null. Não atribuir automaticamente integração às conversas antigas: continuam locais.

Message possui deliveryStatus independente de Conversation.status: LOCAL, RECEIVED,
PENDING, SENDING, SENT, DELIVERED, READ, FAILED. Resposta humana integrada exige requestId,
texto, ownership e permissões existentes, e retorna após persistir intenção, antes do
provider. Alteração de ownership/permissão antes do worker invalida envio ainda pendente.
SYSTEM nunca sai ao canal. A TASK-020, isoladamente, não gerava resposta AI; a
TASK-023 passou a criar a mensagem AI pelo mesmo outbox. Recebimento PATIENT não cria
Patient nem seleciona paciente. O Conversation Engine pode alterar estado/handoff/SLA
somente depois do commit do ingresso e das validações do run.

A Inbox mostra envio pendente/enviado/entregue/lido/falha e diferencia resultado incerto.
Repetir a requisição de composição conserva UUID enquanto a resposta HTTP não for
confirmada; novo texto é nova intenção. Recarregar/fechar o navegador perde o rascunho e
seu UUID: conferir histórico antes de redigitar, especialmente em resultado incerto.
message.status_updated reutiliza invalidação WebSocket e projections autorizadas.
Recibos reais são monotônicos/tolerantes a ordem, diferentemente do helper interno
estrito legado. Contrato de webhook, mídia, retries e configuração em integrations.md.

## Conversation Engine — TASK-023

O webhook persiste `Message` e `AIProcessingRun` na mesma transação. Depois do commit,
um job BullMQ carrega apenas tenant, conversa, mensagem e run. O worker revalida essa
cadeia no PostgreSQL; Redis indisponível não perde a intenção, pois um dispatcher relê
runs pendentes. O runtime só inicia com `CONVERSATION_ENGINE_ENABLED=true`, Redis e a
configuração de IA presentes.

`AIProcessingRun` é único por mensagem inbound e pode apontar para uma única mensagem
de resposta. `ConversationEngineLease` serializa a conversa entre instâncias sem manter
transação aberta durante inferência. O lease tem expiração e heartbeat; crash permite
recuperação. Runs posteriores aguardam os anteriores por `Message.createdAt + id`.
Conversas distintas continuam paralelas.

Uma nova mensagem PATIENT reativa `WAITING_PATIENT` para `AI_ACTIVE`. `NEEDS_HUMAN`,
`HUMAN_ACTIVE`, `RESOLVED` e `CLOSED` encerram ou pulam o run sem resposta automática.
Estado e lease são revalidados antes da inferência, depois de tools e na transação final.

O contexto contém nome/timezone da clínica, contato, paciente ativo somente com vínculo
verificado e autorização de agenda, resumo administrativo e até o limite configurado de
mensagens anteriores ou iguais à mensagem do run. Metadata, documentos, credenciais e
dados clínicos não entram no contexto. Conteúdo textual passa pela sanitização da
TASK-021.

A saída é JSON Schema estrito com intenção, confiança, resposta, espera do paciente,
motivo de handoff, resumo e tool calls. Não há decisão por prefixo ou regex sobre texto
livre. Pergunta clínica, reclamação, pedido explícito de humano, baixa confiança e erro
definitivo terminam em `NEEDS_HUMAN`, com razão, resumo mínimo, SLA e auditoria.

Tools passam pelo `ToolGateway` dentro de um grant efêmero ligado a run/tenant/conversa/
lease. O engine consulta contexto, catálogo, slots e consulta, além de transferir para
humano. Chamadas livres de criação/liberação de HOLD e confirmação permanecem bloqueadas;
a TASK-024 libera somente o payload exato aprovado pelo coordenador. O loop limita
iterações, chamadas e prazo.

A finalização grava intenção, resumo, estado, mensagem AI, run e auditoria em uma única
transação. Se houver integração WhatsApp ativa, a mensagem nasce `PENDING`; o provider
de envio consome a mesma mensagem depois. Falha de envio nunca solicita nova inferência.
Eventos realtime do engine vêm de `QueueEvents` e só são publicados após a conclusão do
job, portanto depois do commit.

## Workflow de agendamento — TASK-024

Quando a intenção é `SCHEDULING`, a saída estruturada pode emitir um comando de workflow
por iteração. A IA interpreta linguagem e formula perguntas; o coordenador valida a
transição, resolve somente recursos tenant-scoped e executa ações pelo Tool Gateway.
Comandos da IA não podem declarar `APPOINTMENT_CREATED`, tenant, HOLD ou Appointment.

`START` obtém `get_contact_context`. Um único vínculo SELF elegível ou o Patient ativo
inequívoco pode ser reutilizado; múltiplos vínculos exigem desambiguação. Somente vínculos
ativos `VERIFIED` com `FULL` ou `SCHEDULING_ONLY` são selecionáveis. `DECLARED`,
`REVOKED` e `NO_ACCESS` não aparecem e não são promovidos.

Perguntas deixam a Conversation em `WAITING_PATIENT`; a próxima Message PATIENT usa a
reativação da TASK-023. A resposta final continua sendo Message AI persistida antes do
envio e produz os mesmos eventos realtime. Conclusão da consulta não fecha a conversa.
Handoff muda também o workflow para `NEEDS_HUMAN`, preservando resumo e seleções para o
atendente, sem estender o HOLD.

## Alteração de consultas por conversa — TASK-025

As intenções `CANCELLATION` e `RESCHEDULING` usam o mesmo workflow persistido do
agendamento, com tipo e etapas próprias. Identificação de Patient continua baseada no
ContactPatient verificado e autorizado; identificação de Appointment usa uma lista
tenant-scoped de opções numeradas. UUIDs recebidos em texto não substituem esse estado
confiável.

O modelo pode interpretar o pedido, aplicar filtros de data/serviço e solicitar
confirmação. O coordenador controla as transições e bloqueia chamadas livres de
`cancel_appointment` e `reschedule_appointment`. A aprovação do Tool Gateway existe
somente no turno da confirmação explícita e contém o Appointment/HOLD já persistidos.

Ambiguidade de paciente, consulta ou confirmação deve produzir pergunta objetiva; falta
de autorização, estado incompatível, conflito repetido ou baixa confiança segue o
handoff existente. O handoff preserva consulta alvo, preferências e resumo, mas não
executa a alteração nem renova HOLD. A resposta final continua sendo uma Message AI
persistida pelo Conversation Engine antes do envio pelo outbox.

## Informação institucional e Base de Conhecimento

Para intenção `INFORMATION`, o Conversation Engine pode chamar `search_knowledge_base`. A tool é somente leitura e retorna referência mínima, título, categoria, trecho, versão e score. O resultado volta ao AIProvider como dado delimitado para formulação da resposta. A Base não é consultada para comandos transacionais de agenda. `CLINICAL_QUESTION` continua em handoff antes do retrieval; ausência de conhecimento suficiente usa fallback seguro e oferece atendimento humano.

## Configuração efetiva da IA

Cada run do Conversation Engine resolve a versão publicada do tenant no início e persiste seu ID em `AIProcessingRun` e `AIUsage`. Um draft nunca participa do atendimento real. Publicar durante uma conversa afeta somente o próximo run; o run em andamento conserva a versão que resolveu.

Nome, tom, saudação, tópicos administrativos, Base de Conhecimento, capabilities e parâmetros do modelo vêm da versão efetiva. Pergunta clínica, reclamação e pedido explícito de humano permanecem regras fixas. Tools desabilitadas são removidas do prompt e recusadas novamente no engine/Tool Gateway. Ausência de conhecimento e negociação de pagamento seguem a política de handoff publicada, sem autorizar resposta inventada.
