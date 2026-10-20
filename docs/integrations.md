# Integrações

## 1. Princípio

Toda integração externa fica atrás de um provider.

## 2. WhatsApp

Canal inicial oficial.

Fluxo:

```text
WhatsApp
→ webhook
→ persistência
→ processamento
→ resposta
```

Requisitos:

- idempotência;
- status de entrega;
- anexos;
- textos;
- áudio;
- documentos;
- interações.

## 3. Calendário

Interface `CalendarProvider`.

Implementações futuras:

- Google Calendar
- Outlook
- calendário interno
- outros providers

O calendário externo não substitui o banco interno.

### Google Calendar (TASK-029)

A integração Google é configurada por tenant e aponta para um calendário
compartilhado. Credenciais OAuth não são gravadas no PostgreSQL: a configuração
persiste somente uma referência resolvida no ambiente do backend/worker.

Toda criação, remarcação ou cancelamento é concluída primeiro no banco interno. A
mesma transação registra uma revisão de sincronização; BullMQ transporta somente os
identificadores e o worker recarrega o estado tenant-scoped. O evento externo usa
horários absolutos em UTC acompanhados do timezone IANA da unidade (ou do tenant) e
contém apenas serviço e localização administrativa, sem paciente, telefone, notas,
dados clínicos ou convidados.

`extendedProperties.private.appointmentId` é a chave de recuperação idempotente.
Assim, um retry após crash entre a criação no Google e o commit local localiza o
evento existente. A reconciliação é limitada por horizonte e paginação; erros
transitórios usam retry limitado, enquanto credencial/configuração inválida exige
ação administrativa.

## 4. OpenAI

A integração de IA deve ficar isolada em provider/service.

Não espalhar chamadas de API em vários módulos.

Criar camada própria para:

- geração;
- tools;
- tracing quando aplicável;
- controle de custo;
- sanitização de contexto.

## 5. Storage

Arquivos devem usar storage compatível com S3.

Banco guarda metadados e referências.

## 6. Credenciais

`INTEGRATION.credentials_reference` deve apontar para segredo armazenado de forma segura.

Evitar credenciais em JSON de banco quando possível.

## 7. Retry

Integrações externas devem possuir retry com backoff quando adequado.

Não criar loop infinito.

## 8. Circuit breaker

Pode ser adicionado posteriormente se volume justificar.

## 9. Estados

Integrações devem possuir:

- ACTIVE
- DEGRADED
- ERROR
- DISABLED

## 10. Observabilidade

Registrar:

- falha;
- provider;
- tenant;
- operação;
- correlation id;
- duração;
- tentativa.

Nunca registrar secrets.

## WhatsApp oficial — TASK-020 (contrato vigente)

`MessagingProvider` define verificação, parsing inbound/status, texto, mídia por ID e
interatividade por botões. `WhatsAppProvider` usa somente HTTPS Graph API oficial, com
versão explícita `WHATSAPP_GRAPH_VERSION` (sem default em produção), bearer token e timeout
10s. Não utiliza SDK arquivado, browser, QR ou WhatsApp Web. A referência oficial usada
para envio foi a [coleção Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc);
a verificação segue o [contrato de webhook publicado pela Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).

Uma aplicação Meta atende várias Integration. App secret e verify token são globais por
aplicação. O Clinic Admin configura por clínica o access token e IDs do número/conta na
tela `/settings/integrations`. O token fica cifrado no registro da Integration com
AES-256-GCM e AAD de tenant + Integration. A chave mestra `TENANT_CREDENTIALS_KEY` é
compartilhada apenas pela API e worker via secret manager/ambiente e nunca é persistida
no banco. Integrações legadas continuam resolvendo `credentialsReference` como alias
`WHATSAPP_ACCESS_TOKEN_<ALIAS>` no worker até serem rotacionadas pela tela. `settings`
permanece nulo. Referências não autorizam leitura de variáveis arbitrárias.

Provisionamento inicial pode ocorrer por `/settings/integrations`, disponível a usuários
com `settings.manage`, ou pelo comando de operador `pnpm whatsapp:configure`. O formulário
permite cadastrar ou rotacionar token, mas não trocar os IDs de uma Integration existente;
a verificação de titularidade do número continua sendo uma etapa operacional externa.
Tenant/número/WABA não podem ser reatribuídos pelo comando. Duas clínicas nunca reivindicam
o mesmo phone_number_id.
`ERROR` por rejeição de credencial suspende novos envios; ingresso/recibos continuam.
`DISABLED` bloqueia ingresso/recibos/envio. Corrigir credencial e reativar é decisão operacional.

### Webhook

- GET `/webhooks/whatsapp`: hub.mode=subscribe, hub.verify_token e hub.challenge.
- POST `/webhooks/whatsapp`: JSON assinado em X-Hub-Signature-256, HMAC-SHA256 dos bytes
  originais com app secret. Comparação constante, ausência/erro retorna 403. Sem Origin
  do navegador somente nesta rota marcada; login e demais escritas mantêm proteção.
- Limite 256 KiB, sem compressão; demais rotas mantêm 8 KiB. Schema validado e projeção
  explícita, máximo 100 mensagens e 100 recibos por lote; sem payload bruto persistido.
- Provider entrega eventos normalizados. ConversationIngressService resolve Integration
  pelo provider + phoneNumberId + WABA, tenant ativo e integração habilitada. tenant_id,
  sender_type e identidades arbitrárias do payload não autorizam nada.
- Transação Serializable com retry limitado e constraints: localizar contato/canal,
  obter/criar conversa pela política compartilhada, inserir Message PATIENT, trigger
  lastMessageAt e audit. Somente após commit publicar message.created. Não executa IA.
- Duplicação, inclusive concorrente, retorna 200 sem duplicar registro/audit. Persistência
  indisponível retorna 503 para reentrega do provider. Schema inválido retorna 400.
  Integração ausente/desativada ou contato inativo são ignorados com log seguro; não
  reativar cadastros nem criar Patient. Tipos externos não suportados são reconhecidos
  com 200 e ignorados; não inventar conteúdo nem tentar interpretar como texto.

Contato usa a normalização TASK-007. Lookup WHATSAPP por tenant/address tem precedência;
se não existir, reutiliza PHONE do mesmo tenant/address e cria canal WHATSAPP, preservando
principal. Se nenhum existir, cria Contact provisório e canal principal. Normalização
não verifica identidade nem autoriza paciente. Não modificar nome cadastrado a cada webhook.

TEXT, IMAGE, AUDIO, DOCUMENT, LOCATION, CONTACT e INTERACTIVE são projetados nos tipos
internos. Mídia mantém mediaRef (ID Meta), mimeType, fileName e caption quando disponíveis.
Sem download, binários, base64 ou transcrição. CONTACT mantém a primeira ficha/número do
payload compatível com o DTO vigente; expansão completa de múltiplas fichas não está
implementada. Tipos/valores fora dos limites do modelo interno são rejeitados com 400.

### Envio e recibos

POST existente `/conversations/:id/messages` em conversa integrada aceita somente texto,
exige UUID requestId, permissão conversation.reply, tenant e ownership HUMAN_ACTIVE.
Message PENDING, destinatário canônico e auditoria são gravados antes da chamada externa.
Mesmo UUID/autor/tenant retorna a mesma Message; payload diferente retorna 409. UUID deve
ser reutilizado na repetição de uma requisição; o composer mantém enquanto a tentativa
não for confirmada. Conversas antigas sem Integration continuam registrando localmente.

Message é outbox indexada. Worker consulta até 100 pendentes a cada 5s, usa fila única
`whatsapp-delivery`, jobId messageId-attempt, payload tenantId/messageId. Revalida integração,
contato, tenant e autorização/ownership do autor antes de enviar. Não há transação aberta
em HTTP. Falha/restart/limpeza Redis não apaga a intenção PostgreSQL.

Claim atômico PENDING→SENDING impede duas chamadas simultâneas. Rejeições explicitamente
transitórias (rate limit ou erro estruturado 5xx) tentam até cinco vezes com backoff
5/10/20/40s, sempre a mesma Message. Erro permanente não repete. Timeout, resposta de
sucesso ilegível ou falha sem resultado conhecido ficam FAILED/SEND_UNCERTAIN. Lease
SENDING de 120s vencida também fica incerta: nunca reenviar automaticamente. Isso evita
retry cego, mas não promete exactly-once externo; confirmação pode chegar por webhook.

O envio leva UUID interno em biz_opaque_callback_data para reconciliar callback precoce
ou resposta perdida. Recibo usa integração/tenant/providerMessageId, destinatário e,
quando ID externo ainda não existe, UUID de mensagem com tentativa iniciada. Não aceita
callback para mensagem nunca enviada. SENT→DELIVERED→READ é monotônico; FAILED não
sobrescreve entregue/lida, confirmação posterior pode recuperar falha incerta. Datas em
UTC são limitadas ao intervalo temporal interno; READ implica DELIVERED. Eventos repetidos
não duplicam audit. Status não altera estado de atendimento da Conversation.

QueueEvents reutiliza RealtimeEvents e publica message.status_updated; a Inbox relê REST.
Sem segundo socket, conteúdo/secrets no evento ou garantia de replay. Falha após commit
não desfaz a Message; reconexão recupera o estado. Logs estruturados registram operação,
correlationId, tenant, providerMessageId, resultado e duração, sem erro bruto ou conteúdo.

Texto fora da janela aceita pela Meta pode exigir template: provider traduz a rejeição,
preserva Message e não contorna a política. Sem gestão/envio de templates nesta etapa;
a interface pode ser ampliada quando um caso de uso autorizado exigir template. Mídia e
interatividade existem no adaptador, mas o composer expõe somente texto. NotificationRule
não é chamada, não há envio automático/IA e não há TASK-021.

## AI Provider — TASK-021

Chave OpenAI é configurada por clínica na mesma área `/settings/integrations`, armazenada
cifrada em `ai_provider_credentials`. A API resolve a chave exclusivamente pelo tenant
autorizado da requisição e falha fechada se ela estiver ausente ou não puder ser decifrada;
não há fallback para a chave global `OPENAI_API_KEY`. Modelo, URL, limites e parâmetros
operacionais continuam sob configuração de ambiente.

`AIProvider` é contrato do domínio; `OpenAIProvider` é o único importador do SDK OpenAI.
Usa Responses API, `store:false`, sem tools e sem acesso ao banco. `AIService` interno
obtém tenant da sessão autorizada; nesta etapa exige `settings.manage` para inferência e
`analytics.view` para consulta interna de consumo. Não há endpoint de IA nem acionamento
por Conversation/WhatsApp. O futuro engine terá sua própria autorização, sem reaproveitar
uma permissão administrativa como bypass.

Configuração central `AIConfigResolver`: OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL,
OPENAI_TIMEOUT_MS e OPENAI_MAX_OUTPUT_TOKENS obrigatórios no primeiro uso. API administrativa
inicia sem configuração. OPENAI_TEMPERATURE é opcional e só deve ser usada se o modelo
escolhido a suporta. Nenhum modelo default; configurar um modelo compatível com Responses.
Retries: OPENAI_MAX_RETRIES (0–3; default 1), OPENAI_RETRY_DELAY_MS (default 250) e
OPENAI_MAX_RETRY_DELAY_MS (default 2000). SDK maxRetries=0; limite externo cobre inclusive
leitura do corpo. Backoff exponencial limitado; Retry-After acima do orçamento encerra a
chamada. Até quatro tentativas, cada uma limitada por timeout. Auth, quota permanente,
configuração, payload e respostas inválidas/incompletas/recusas não são repetidos.
Timeout/rede podem ter sido processados/cobrados: correlação não é chave de idempotência.

`AIInput` só recebe instruções e mensagens preparadas por código confiável, sem tenant,
modelConfig ou objetos de domínio no payload. Roles SYSTEM/USER/ASSISTANT não são
Message.senderType. Limites: 40 mensagens, 16000 caracteres por texto, 64000 no contexto.
Sanitização redige padrões de credenciais, CPF, telefone e email; não identifica toda
informação sensível em prosa (endereço/histórico clínico, por exemplo). O chamador deve
selecionar dados mínimos; não repassar DTO/paciente/histórico completo. Não expor este
service diretamente como body HTTP, nem permitir system instructions do usuário final.
IDs de tenant não são enviados no prompt; correlationId UUID vai como X-Client-Request-Id.
SDK logging fica off independentemente de OPENAI_LOG. Logs da aplicação têm só metadata.

Response contém texto não confiável, finishReason completed, usage nullable, modelo,
provider, request ID quando disponível, latência e tentativas. JSON schema opcional usa
text.format strict, com validação de sintaxe JSON local; validação de schema de negócio
continua obrigatória no futuro consumidor antes de qualquer ação. Nenhuma ação nesta task.

AIUsage registra PENDING antes de HTTP e finaliza SUCCESS/ERROR no tenant original. O
capability de conclusão só atualiza esse registro pendente; revogar a sessão não apaga
consumo já iniciado. Repository revalida tenant e RBAC ao iniciar/listar. Não há transação
aberta durante HTTP. Falha de gravação final gera log seguro e conserva PENDING, sem repetir
inferência nem descartar resposta útil. Crash também pode deixar PENDING; reconciliação
operacional futura. Tokens ausentes ficam null, custo Decimal fica null (sem pricing).
Tokens informados em resposta incompleta são preservados; custo de tentativas sem usage
é desconhecido. Metadata não substitui a fatura do provider.

Testes usam FakeAIProvider e fetch injetado no SDK; nunca chamadas pagas. Não há fallback
silencioso para fake em produção, circuit breaker, dashboard, engine ou Tool Gateway.
Referências: [Responses](https://developers.openai.com/api/docs/guides/text),
[Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
[Erros](https://developers.openai.com/api/docs/guides/error-codes).

## Tool Gateway — TASK-022

Registry explícito: get_contact_context, list_specialties, list_services,
search_available_slots, create_hold, get_appointment, confirm_appointment,
reschedule_appointment, cancel_appointment e transfer_to_human. Zod é fonte dos tipos,
validação e JSON schemas de entrada/saída. `definitions()` fornece name/description/
inputSchema/outputSchema independentes do SDK; o futuro adapter/engine poderá apresentá-los
ao modelo. Nenhum loop/tool calling é ativado no AIProvider nesta entrega.

ToolCall recebe name, arguments como objeto JSON já decodificado e callId obrigatório
opaco (até 100 caracteres alfanuméricos/_/-). Campos extras são rejeitados. Todas as saídas
são projeções validadas, nunca entidades Prisma completas. Texto armazenado é dado; não
promover nome de serviço/resposta da ferramenta a system instructions. Handlers chamam
services existentes; repository de contexto resolve apenas identidade, autorização e
projeção mínima. Scheduling ganhou camada de busca pois antes só havia validação de slots.

Contexto via beginTurn contém conversationId, actorType e correlationId opcional UUID;
approvedMutations vincula intenção confiável a nome + argumentos exatos para confirmar,
cancelar ou remarcar. Não vem da IA. Tenant/contact/patient/actorId são derivados do backend.
Não há endpoint público/de desenvolvimento. Sem sessão válida, inclusive ator AI, falha.

Limites por ambiente: TOOL_CALLS_PER_TURN (default8, 1–16), TOOL_TIMEOUT_MS (default5000,
100–10000), TOOL_TURN_TIMEOUT_MS (default30000, 1000–60000). Payload máximo8KiB. Contagem
inclui tentativas inválidas/replays e é compartilhada pelas chamadas concorrentes do turno.
São budgets por turno confiável, não rate limiter distribuído por clínica. Engine futuro
não deve criar turnos ilimitados para contornar orçamento. Sem retries automáticos.
Timeout abrange autorização, contexto, handler e retorno; operações de banco já iniciadas
não são magicamente canceladas, mas escrita/commit verifica deadline e revalida contexto.

Erros seguros: TOOL_NOT_FOUND, INVALID_ARGUMENTS, UNAUTHORIZED, FORBIDDEN,
RESOURCE_NOT_FOUND, INVALID_RELATIONSHIP, SLOT_UNAVAILABLE, HOLD_EXPIRED,
APPOINTMENT_CONFLICT, INVALID_APPOINTMENT_STATE, TOOL_TIMEOUT, INTERNAL_ERROR,
TOOL_LIMIT_EXCEEDED, CONFIRMATION_REQUIRED, CALL_IN_PROGRESS, IDEMPOTENCY_CONFLICT.
Sem mensagem SQL/stack/erro cru. Retryable=false evita repetição cega de mutação incerta.

Chave durável: tenant/conversation/callId. Hash de nome+argumentos canonicalizados impede
reutilização divergente e contexto inclui executor/paciente. HOLD recebe id do ledger como
requestId. Mutações repetidas retornam resultado anterior após revalidar contexto/RBAC;
RUNNING retorna CALL_IN_PROGRESS. Leitura não persiste resposta pessoal e requer novo
callId para nova consulta. Handoff replay não abre ciclo adicional; após handoff novas
chamadas AI são bloqueadas. Resultados mutáveis persistidos são mínimos e sem texto livre.
Falha de finalização deixa RUNNING com log seguro para reconciliação; não repetir despacho.

Métricas podem derivar de ToolExecution (status/duração/tool/tenant) e logs técnicos. Sem
dashboard, prompt de clínica, Knowledge Base, engine, WhatsApp automático ou TASK-023.

## Envio automatizado de confirmações e lembretes — TASK-028

As automações não acessam a API do WhatsApp diretamente. O processor valida o estado
vigente no PostgreSQL e cria uma Message `TEXT`/`PENDING` na outbox existente. O worker
de entrega chama `MessagingProvider`, aplica a idempotência da Message e grava o
`providerMessageId`; depois a reconciliação promove o `NotificationAttempt` e decide
retry funcional ou encerramento.

Uma falha incerta de rede segue a política conservadora da outbox da TASK-020. O job de
notificação não cria outra Message para a mesma tentativa. Payloads BullMQ não contêm
telefone, texto nem credenciais, e logs não registram conteúdo. Sem Contact, canal
WhatsApp ativo, Conversation compatível ou Integration ativa/degradada, a tentativa é
encerrada com código operacional seguro e nenhuma chamada externa é feita.
