# Segurança e Privacidade

## 1. Princípio

Segurança não depende do prompt da IA.

## 2. Multi-tenancy

Toda operação de negócio deve validar tenant.

Padrão conceitual:

```text
resource.id = ?
AND resource.tenant_id = current_tenant
```

Nunca buscar recurso apenas pelo ID.

## 3. Defesa em profundidade

Aplicar:

1. tenant ativo na sessão;
2. autorização no service;
3. filtro obrigatório no repository;
4. testes de isolamento.

Avaliar PostgreSQL Row Level Security posteriormente como camada adicional.

## 4. Autenticação

- senha com hash moderno;
- MFA disponível;
- MFA obrigatório para SUPER_ADMIN;
- sessão segura;
- rate limiting;
- proteção contra brute force.

## 5. Autorização

Frontend não autoriza.

Backend deve validar:

- tenant;
- papel;
- permissão;
- unidade;
- relação contato/paciente quando aplicável.

## 6. Dados de paciente

Enviar à IA apenas o mínimo necessário.

Evitar dados sensíveis quando não forem necessários à tarefa.

## 7. Representantes

Não aceitar automaticamente "sou mãe", "sou marido" etc. como autorização completa.

Separar:

- relacionamento declarado;
- relacionamento verificado;
- nível de autorização.

## 8. Prompt injection

A IA deve operar com:

- tools fechadas;
- schemas validados;
- menor privilégio;
- output validation;
- context sanitization.

A IA nunca recebe:

- SQL;
- credenciais;
- chaves;
- secrets;
- dump de banco;
- dados irrelevantes de outros pacientes.

## 9. Tool Gateway

Cada tool deve validar novamente permissões.

Nunca assumir que, porque a IA chamou a tool, a ação está autorizada.

## 10. Webhooks

- verificar autenticidade quando provider suportar;
- idempotência;
- validação de schema;
- limite de payload;
- logs seguros.

## 11. Segredos

Usar variáveis de ambiente/secret manager.

Nunca commitar `.env`.

## 12. Logs

Não registrar:

- senha;
- token;
- secret;
- payload clínico desnecessário.

Mas manter audit trail apropriado.

## 13. Auditoria

Registrar:

- usuário;
- ação;
- recurso;
- valores relevantes;
- timestamp;
- tenant.

## 14. Segurança da agenda

Toda modificação deve registrar ator.

## 15. Testes obrigatórios

- tenant A não acessa tenant B;
- usuário sem permissão recebe 403;
- contato não autorizado não recebe dados;
- IA não consegue contornar Tool Gateway;
- resource ID de outro tenant não funciona;
- webhook duplicado não duplica mensagem.

## Autenticação inicial — TASK-003

A autenticação identifica uma pessoa global; não concede acesso a nenhuma clínica.
Sessão de tenant e permissões serão implementadas nas TASK-004/005.

- Senhas usam scrypt (N=131072, r=8, p=1), salt aleatório e comparação constante.
  Limite de duas derivações simultâneas por processo; senhas de 12 a 128 caracteres.
- Sessões são tokens opacos de 256 bits, com apenas SHA-256 persistido; duração
  absoluta de oito horas. Login renova o token apresentado; logout o remove do banco.
- Cookie HttpOnly/SameSite=Strict; produção usa Secure e prefixo __Host-, sem Domain.
  Produção exige HTTPS e AUTH_ORIGIN exata. AUTH_SECRET tem no mínimo 32 caracteres.
- Todas as rotas têm guard por padrão; exceções explícitas: health e login.
  POST exige Origin igual a AUTH_ORIGIN. Login aceita apenas JSON com limite de 8 KiB.
- Limites persistentes de login: 20 tentativas por IP e 5 por email a cada 15 minutos,
  inclusive tentativas bem-sucedidas. Incremento atômico; não confiar em X-Forwarded-For.
  Ao configurar reverse proxy, revisar explicitamente quais proxies são confiáveis.
- Eventos de identidade ficam em auth_events, sem senha/token/email. IP e chave de
  conta para limitação usam HMAC com AUTH_SECRET. Eventos não são alterados pela aplicação.
- MFA nesta tarefa é somente base: mfa_enabled ou mfa_required bloqueia login por
  senha e validação de sessões. Não há TOTP, enrollment ou códigos de recuperação.
  Não há provisionamento de SUPER_ADMIN; quando houver perfis, SUPER_ADMIN deverá
  exigir MFA completo antes de obter sessão. Não tratar esses campos como MFA concluído.
- Sem cadastro público; comando local de desenvolvimento cria identidade sem
  vínculos ou papéis. Erros de login não distinguem conta ausente, desativada ou MFA.
- Sessões expiradas e contadores antigos não são válidos mesmo antes de limpeza.
  Retenção/limpeza operacional deve preservar os eventos de auditoria; não há job
  automático nesta tarefa. Rotacionar AUTH_SECRET reinicia as chaves de limitação,
  mas não revoga sessões: revogação precisa remover os registros de sessão.

## Isolamento de tenant — TASK-004

O guard de tenant é obrigatório por padrão após autenticação. Exceções de
identidade/listagem/seleção são explícitas e não expõem recursos clínicos.
TenantContext é por requisição e usa apenas o snapshot autenticado de sessão.
Services e repositories revalidam; queries de Unit incluem tenant_id e condições
de vínculo/sessão/usuário ativos na própria consulta. Conhecer o ID de outro tenant
não basta. Role não permite bypass, inclusive SUPER_ADMIN.

UserTenant inativo ou Tenant com status diferente de ACTIVE bloqueia acesso.
Remover UserTenant revoga sessões selecionadas pela FK composta. Troca simultânea
de tenant faz o snapshot antigo falhar fechado. Os testes de integração exercitam
as duas direções A/B, concorrência, revogação entre validação e consulta, contexto
forjado, sessões independentes e ausência de endpoints de alteração de unidades.
RLS permanece uma camada futura; APIs funcionais novas deverão usar o mesmo padrão
obrigatório de contexto e repository, além das permissões da TASK-005.

## Autorização por permissão — TASK-005

PermissionGuard global executa após autenticação e contexto de tenant. Rotas sem
política explícita falham com 403. TenantOptional não isenta RBAC: exceções de
identidade/seleção são marcadas separadamente. A matriz fica em docs/tenancy.md e
no catálogo versionado de backend; não existe autorização decidida no frontend.

AuthorizationService revalida UserTenant do tenant ativo, role operacional
habilitado e permissões persistidas, além de usuário/sessão/tenant. Repositories
repetem as condições na consulta ao recurso, para não depender só de uma checagem
anterior. Role/permissões de headers, body ou query nunca autorizam. Sessões não
guardam cópias de permissões. Testes cobrem 403, permissões administrativas,
políticas cumulativas, revogação e papéis distintos por tenant.

SUPER_ADMIN continua sem capacidade privilegiada até existir MFA completo; ter
esse texto em um vínculo não habilita administração nem contorna isolamento.
MANAGER e roles desconhecidos também não autorizam. Os campos MFA existentes
continuam com comportamento de bloqueio da TASK-003. Seed RBAC é uma operação
administrativa explícita de aplicação de política versionada; não promove usuários
nem registra segredos. Concessões locais por tenancy:grant permanecem auditadas.

## Escritas de configuração — TASK-006

CRUD de unidades e alterações da clínica selecionada exigem settings.manage no
backend, além dos guards de identidade/tenant. Services e repositories repetem a
verificação. DTOs com campos extras são rejeitados para evitar atribuição de IDs,
tenant, papel ou campos geridos pelo servidor. POST/PATCH/DELETE exigem Origin;
CORS permite os métodos novos somente à origem configurada.

Escritas usam transação Serializable com revalidação de sessão, vínculo e permissão
no banco. Updates também incluem filtros de autorização na própria consulta.
Conflito de serialização retorna 409 para nova tentativa; falha de auditoria desfaz
a escrita. Eventos são inseridos na mesma transação e não possuem endpoints de
alteração. Não existe exclusão física de clínicas ou unidades.

Criação de clínica fica no provisionamento local de desenvolvimento, com usuário
existente e trilha explícita. settings.manage não autoriza criar clínicas externas.
Não foi acrescentado bypass para SUPER_ADMIN ou para clínica inativa.

## Contatos/canais — TASK-007

Rotas exigem contact.view/contact.edit, tenant ativo e sessão válida; serviços e
repositories revalidam. DTOs rejeitam IDs, tenant, contactId, verifiedAt e campos
extras. Normalização de telefone é sintática, não valida posse, não autentica
pessoa e não autoriza qualquer acesso a paciente. Identificador externo também
não concede autorização; não existe provider WhatsApp nesta entrega.

Transações Serializable, FK composta e índices únicos protegem criação, atualização
e troca de principal. Escritas de canal também atualizam o contato para serializar
mudanças concorrentes. Conflitos retornam 409 genérico sem divulgar nome, telefone,
tenant, ID conflitante ou detalhe SQL. Qualquer falha, inclusive de auditoria,
desfaz toda a operação. Um 409 concorrente exige recarregar e tentar novamente.
A auditoria persiste somente IDs/ação/campos alterados; não replica dados pessoais.
Erros de validação não ecoam o telefone fornecido.

## Pacientes e representantes — TASK-008

patient.view/patient.edit controlam o painel administrativo por usuário autenticado
no tenant. Gerenciar vínculos exige também contact.view. patient.authorize,
exclusiva de CLINIC_ADMIN nesta etapa, permite verificar vínculo, conceder FULL ou
SCHEDULING_ONLY e afirmar representante legal. AGENT pode declarar NO_ACCESS,
restringir e revogar. SELF ou uma declaração de parentesco nunca autoriza por si.
Verificação é uma decisão explícita de funcionário autorizado; não há autenticação
de contato externo nem verificação documental automatizada nesta entrega.

PatientAccessService.forContact aplica conjuntamente tenant, sessão/RBAC, vínculo
ativo VERIFIED/FULL e Contact ACTIVE na consulta que lê o Patient. NO_ACCESS,
SCHEDULING_ONLY, DECLARED, REVOKED e ausência de vínculo não liberam a leitura.
O retorno contextual contém somente id/name/birthDate; não inclui documento,
convênio, pagamento, notas, tenant ou autores internos. A lista administrativa usa
o mesmo resumo; o detalhe administrativo contém os campos editáveis de Patient.

GET /patients é acesso administrativo de funcionário autorizado, não autenticação
de representante. Integrações futuras deverão autenticar o canal/contato e chamar
a política contextual a cada operação; não podem usar a rota administrativa como
atalho. Conhecer patient_id/contact_id não substitui identidade, tenant, RBAC e
vínculo. IDs externos/inexistentes e vínculo insuficiente retornam o mesmo 404;
sem permissão de usuário, 403; sem sessão, 401.

DTOs rejeitam tenant/atores/datas técnicas e campos extras; autoria é sempre do
servidor. Services e repositories validam permissões; queries repetem filtros de
autorização. Transações Serializable e lock de escrita do Patient serializam
mudanças dos vínculos/principal. Conflitos retornam 409 genérico; auditoria falhou,
operação é desfeita. Revogar mantém histórico e bloqueia a próxima consulta.

## WebSocket — TASK-017

`GET /realtime` via upgrade reutiliza o cookie HttpOnly de AuthService, exigindo
Origin exatamente igual a AUTH_ORIGIN e sessão com tenant ativo. Query strings,
IDs de tenant/subscription e tokens no URL não são aceitos. O endpoint de upgrade
não passa pelos guards HTTP do Nest: aplica explicitamente autenticação existente
e authorizedTenantFilter com conversation.view + contact.view. Nenhuma credencial
nova é criada. Respostas HTTP de recusa são genéricas.

Cada entrega revalida usuário/sessão/vínculo/tenant/RBAC no banco; leitura da
conversa ou mensagem também repete o filtro. Usuário inativo, MFA pendente, sessão
expirada/revogada e tenant inválido bloqueiam. A política de unidade é a mesma da
Inbox REST atual: Conversation não tem escopo adicional por unidade neste modelo.
Não criar autorização mais permissiva no transporte.

Logout, renovação de login e seleção de tenant invalidam conexões locais da sessão
após commit. Heartbeat de 20s revalida sessões ociosas; alterações administrativas
sem evento encerram a conexão até o próximo heartbeat. Antes de qualquer entrega
protegida a validação é repetida, independentemente desse intervalo. Ping/pong
encerra conexões mortas. Mensagens client→server são rejeitadas (1008), maxPayload
1 KiB, fila por conexão limitada a 100 avisos e buffer de saída a 1 MiB; clientes
lentos são desconectados para ressincronizar.

Logs registram abertura/fechamento (tenant/user), publicação (eventId/tipo/IDs) e
falhas genéricas. Não registram cookies, tokens, conteúdo ou metadados clínicos.
O cliente trata eventos apenas como invalidação e mantém escaping React no REST.

## Ownership de atendimento — TASK-018

Message USER exige estado HUMAN_ACTIVE e assignedUserId igual ao ator da sessão,
além de conversation.reply, no service/repository existente. Transferência não
concede bypass de resposta: deve ser executada explicitamente com permissão
conversation.transfer e alvo elegível no tenant. Return/resolve exigem ownership.
Claim concorrente é decidido por PostgreSQL Serializable com lock e update
condicional; timestamps/audit/estado são atômicos. Generic status não contorna
esse fluxo. Usuário inativado perde acesso imediatamente pelas validações existentes;
recuperação da conversa é transferência manual por operador autorizado.

## SLA humano — TASK-019

Configuração e preview exigem settings.manage nos guards/services/repositories,
com filtro SQL de tenant/sessão/permissão. Frontend não fornece tenant/ator/ciclo.
Atendentes veem alertas nas projections autorizadas da Inbox existente.

Jobs internos contêm somente tenantId/jobId, derivados da transação de handoff.
Worker valida o job no mesmo tenant e reconsulta regra/tenant/ciclo/conversa sob
lock, sem confiar apenas no payload Redis. Não existe endpoint público para executar
job ou definir slaLevel. FKs compostas e constraints protegem escritores SQL.
Mensagens, contatos, pacientes, tokens e destino externo não são copiados para jobs.
Alterações, alertas e limpeza são auditados atomicamente. Acesso à infraestrutura
Redis é administrativo, não canal autenticado de usuário. O gateway mantém sua
validação de acesso por evento; QueueEvents não autoriza leitura por si.

## Webhook e envio WhatsApp — TASK-020

Somente o controller explicitamente marcado auth:provider-webhook é isento de Origin
para POST externo. Public isoladamente continua insuficiente para contornar Origin.
Webhook verifica HMAC-SHA256 constante sobre bytes originais antes de JSON/processamento;
limite específico 256 KiB sem descompressão; validação em lista de campos normalizados.
GET challenge exige verify token; logs da aplicação não registram URL/query/header/body.
Na implantação, também redigir tokens na configuração de logs do proxy externo.

Tenant deriva exclusivamente da Integration configurada por operador, phoneNumberId e
WABA autenticados pelo app secret. Nenhum cadastro/reatribuição de número pela API de
clínica. Integration credentialsReference resolve somente namespace próprio de tokens;
settings null é exigido pelo banco. Verificação do webhook não equivale à autenticação
do contato/paciente; nenhuma autorização clínica é inferida.

Envio exige RBAC/ownership/tenant na transação de intenção e revalida associação, papel,
permissões, contato, estado/responsável e integração antes de chamar o provider no worker.
Transferir/resolver após a reserva transacional do envio não revoga a chamada externa
já autorizada por esse claim; não existe transação distribuída com a Meta.
Jobs carregam somente tenantId/messageId, nunca texto/token. Requests usam bearer no header
para host Graph fixo, não aceitam URL externa/redirect arbitrário. Erros Meta são convertidos
em códigos internos; raw error/body/headers não chegam a audit/logs/responses.

Idempotência tem constraints SQL e transações Serializable; não depende só de SELECT.
Erro externo não apaga Message. Resultado incerto não é repetido automaticamente.
Recibos validam tenant/integração/destinatário e correlação de tentativa iniciada; conhecer
UUID de Message alheia não autoriza mutação. Projections REST e gateway mantêm RBAC.

## Tool Gateway — TASK-022

`ToolGateway` é interno, sem controller/endpoint de execução. `beginTurn` só é chamado
por código confiável, com sessão humana real; emite objeto opaco vinculado por identidade
ao request/service. Tenant, contato e paciente ativo vêm da sessão e Conversation, nunca
dos argumentos do modelo. Contexto fabricado, campos extras e ferramentas desconhecidas
falham fechado. Ator AI usa dez capacidades explícitas **intersectadas** com RBAC do usuário
executor; não existe usuário fictício nem permissão administrativa implícita. Execução
autônoma da TASK-023 usa o grant interno descrito abaixo, sem fabricar membership ou
sessão humana.

AI só opera AI_ACTIVE. USER opera AI_ACTIVE ou HUMAN_ACTIVE sendo o responsável. Demais
estados bloqueiam atendimento. Replay de handoff já concluído pode retornar seu resultado
em NEEDS_HUMAN, com as mesmas verificações de identidade/contexto, sem novo ciclo.

Operações de agenda exigem paciente ativo e ContactPatient ativo VERIFIED com FULL ou
SCHEDULING_ONLY. Conhecer UUID não concede acesso; Appointment/HOLD deve corresponder ao
mesmo contato e paciente da conversa. Dados clínicos, documentos, nascimento, notas e
preços não são retornados pelas tools. Catálogo e solicitação de humano não requerem
acesso a paciente: relação insuficiente não impede pedir ajuda. get_contact_context omite
vínculos não autorizados e retorna activePatientId null se não houver vínculo permitido.

Cancelar/remarcar/confirmar exigem aprovação estruturada do **payload exato** em beginTurn,
fornecida pelo chamador confiável após resolver a intenção. Nenhum argumento do modelo
liga essa aprovação. Não há interpretação de texto nem confirmação automática nesta task.
Services existentes continuam aplicando RBAC e regras de domínio. Boundary interno via
AsyncLocalStorage revalida Conversation/Patient sob lock dentro das transações existentes
de HOLD, Appointment e handoff; deadline também é checado antes do commit. Sem alteração
no comportamento das rotas humanas quando não há boundary de tool.

ToolExecution contém intenção/outcome técnico, ator AI/USER e usuário executor, tenant,
conversa/contato/paciente, correlação, fingerprint e target. Sem argumentos, prompt, segredo
ou conteúdo clínico. Resultados mutáveis cacheados contêm apenas IDs/instantes/status/motivo
enumerado. Leituras não são cacheadas. Recusas com contexto autorizado são auditadas;
contexto inválido/revogado não permite criar audit em tenant arbitrário. Logs usam allowlist.

Um timeout não prova ausência de commit. Ledger RUNNING bloqueia nova execução da mesma
chave; resultado tardio finaliza a mesma intenção. Crash entre commit e finalização exige
reconciliação, nunca reset/retry automático. Auditoria de domínio continua atômica com a
mutação e identifica usuário real; ledger preserva a origem AI delegada. Nenhum SQL/código/
URL arbitrário ou integração externa é ferramenta deste registry.

## Conversation Engine — TASK-023

Cada turno autônomo começa em um `AIProcessingRun` já relacionado por FKs compostas ao
tenant, conversa e mensagem PATIENT. O job Redis contém somente esses UUIDs. Antes de
inferência, a aplicação valida tenant ativo, estado da conversa, mensagem, ordem e lease.
O modelo nunca recebe tenantId como autoridade e não acessa Prisma, SQL ou repositories.

Um grant efêmero liga run, conversa, tenant e owner do lease. `AsyncLocalStorage` torna o
grant visível apenas durante o callback do worker; uma registry privada deixa filtros SQL
reconhecerem esse escopo enquanto ele está ativo. Depois do callback, o mesmo objeto deixa
de autorizar consultas. Não há controller para criar grant. A admissão é revalidada no
banco e permite somente o conjunto mínimo usado por inferência e pelas tools liberadas.

Nesta task, o engine pode usar tools de leitura e `transfer_to_human`. Mutações de agenda
ficam negadas no gateway, mesmo estando no registry geral da TASK-022. ToolExecution usa
o run como actorId técnico de AI; audits de domínio não apontam esse UUID para User.

Contexto é projetado por allowlist, limitado em quantidade e no tempo até a mensagem do
run. Metadata, credenciais, documentos e dados clínicos são omitidos. Sanitização é defesa
adicional, enquanto autorização permanece nos services/repositories. Saída inválida,
timeout, perda de lease e erro definitivo resultam em falha segura e handoff; nunca em
execução de texto livre.

Resposta e resumo são persistidos antes do evento realtime e do envio. Falha de provider
de mensagens altera somente deliveryStatus da Message já criada. Idempotência do run e
FK única de resposta impedem regenerar ou enviar uma segunda resposta por retry do job.

## Conteúdo recuperado da Base de Conhecimento

Conteúdo editorial é dado não confiável, mesmo depois de publicado. O backend remove scripts, tags HTML e caracteres de controle, limita o tamanho e o entrega ao AIProvider em um bloco `KNOWLEDGE/TOOL CONTEXT` separado das instruções de sistema. Comandos, SQL, chamadas de tool e tentativas de prompt injection presentes no artigo não têm autoridade. A tool não aceita `tenantId`; o contexto interno define o tenant e o repository filtra tenant, publicação e vigência antes do ranking. Um miss de retrieval gera fallback controlado e não permite que uma afirmação factual inventada seja persistida.

## Configuração de IA por tenant

Texto administrativo configurado pelo tenant tem autoridade inferior às regras fixas da plataforma. A validação recusa campos extras, padrões de segredo e tentativas explícitas de ignorar tenant, autorização, SQL ou handoff clínico. Essa validação é defesa adicional: tenant, RBAC, capabilities e execução de tools continuam impostos por código e consultas tenant-scoped.

A simulação é `DRY_RUN`: pode ler somente a Base de Conhecimento publicada do tenant e não cria turno de tools, HOLD, Appointment, Message ou envio externo. Publicação e restauração exigem `ai_config.publish`; criação/edição/simulação exigem `settings.manage`; leitura exige `settings.view`. Todas as mudanças e simulações geram auditoria sem copiar instruções completas para o evento.

## Auditoria consolidada — TASK-030

A auditoria de negócio usa a tabela histórica auth_events evoluída, com contexto
estruturado de ator/origem/recurso, sanitização central e escrita transacional.
Atribuição via IA é AI/AI_ENGINE, mesmo quando há executor humano autorizado;
ToolExecution preserva o executor técnico sem criar segunda auditoria da mutação.
Consulta exige audit.view e revalida tenant/RBAC na query. Não há endpoints de
alteração/exclusão. A matriz, exceção de identidade global e limitações de histórico
estão em [audit.md](audit.md). As regras desta seção atualizam as descrições
anteriores de autoria da auditoria nas tasks de tools e engine.
