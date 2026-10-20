# Super Admin — TASK-032

## Escopo e autorização

O dashboard de clínica continua tenant-scoped. A plataforma tem contexto separado
`PlatformScope { userId, sessionId }`, criado no backend após autenticação de
plataforma. `PlatformAdmin` é a concessão global equivalente a SUPER_ADMIN; o texto
SUPER_ADMIN em UserTenant não concede acesso. Nenhum repository comum ganhou bypass.

`@PlatformOnly` exige sessão própria, usuário ACTIVE, concessão ativa e enrollment
TOTP confirmado. O repository repete a validação no snapshot das consultas. A sessão
clínica não autoriza a plataforma nem o contrário. Anônimo recebe401, identidade
clínica recebe403. `platformScope`, tenant do ator e flags enviados pelo cliente
não participam da autorização. DTOs rejeitam chaves não previstas.

O target tenant vem da rota de detalhe, é validado e limita todas as projeções.
Cada abertura do detalhe gera PLATFORM_TENANT_VIEWED com ator real e tenant alvo.
Logs técnicos registram ação, ator, alvo, duração e código seguro; nunca payload.

## Autenticador e provisionamento

TOTP RFC6238, HMAC-SHA1, seis dígitos,30s, janela de tolerância ±1. Cada passo pode
ser consumido uma vez, com lock transacional da concessão. Senhas usam o scrypt
existente. Limite persistido de5 tentativas por identidade e20 porIP em15min,
compartilhado entre enrollment/login de plataforma; a clínica mantém seu próprio
limite. Cookie HttpOnly, SameSite Strict, Secure em produção, expiração absoluta1h.
Mutações verificam Origin no guard global.

`PLATFORM_MFA_KEY`: chave exclusiva de32bytes em base64, fornecida pelo ambiente/
secret manager. Sem default. `PLATFORM_MFA_DISABLED=true` permite login somente por
senha apenas quando `NODE_ENV=development`; use exclusivamente no Compose local de
testes. Em qualquer outro ambiente, MFA continua obrigatório mesmo se a variável
estiver configurada. O secret TOTP é cifrado AES-256-GCM com nonce aleatório
por escrita e userId como associated data. Nunca copiar a chave para código,
planilha ou logs. A URI/secret de enrollment é retornada somente após senha e
convite válidos, com no-store, e renderizada como texto. O usuário adiciona a chave
manualmente a um app autenticador; não há serviço externo para gerar QR.

Operador autorizado com acesso ao ambiente pode executar:

```sh
pnpm --filter @atendente/api platform:admin
```

Configurar previamente no ambiente seguro:

- PLATFORM_ADMIN_EMAIL: usuário existente e ativo;
- PLATFORM_OPERATOR_USER_ID: identidade do operador real, registrada na auditoria;
- PLATFORM_ADMIN_ACTION: `grant` ou `revoke`;
- PLATFORM_INVITE_FILE: caminho novo para convite (grant), criado com modo0600;
- DATABASE_URL, AUTH_SECRET, AUTH_ORIGIN e PLATFORM_MFA_KEY conforme ambiente.

O comando não cria usuários, não concede membership de clínica e não oferece API
HTTP de promoção. Autoridade de bootstrap é o acesso operacional ao host/banco;
PLATFORM_OPERATOR_USER_ID identifica o operador e não é credencial de autorização.
Não expor o comando em interface web. O convite dura30min, exige senha e confirmação
TOTP e é consumido ao confirmar. Entregar o arquivo por canal seguro e removê-lo
após entrega. `/super-admin` permite cadastrar autenticador com convite e depois
entrar com senha+código. Após confirmar, aguardar o próximo código para login.

Recuperação: novo `grant` revoga sessões e credencial anterior, gerando novo convite.
`revoke` desativa concessão e apaga sessões. Não existe bypass HTTP de MFA ou código
mestre. Rotação de PLATFORM_MFA_KEY exige re-enrollment operacional dos administradores
e revogação das sessões; não trocar a chave silenciosamente em produção.

## Endpoints

- POST /super-admin/enroll: convite+senha; sem code inicia, com code confirma.
- POST /super-admin/login: senha+TOTP.
- POST /super-admin/logout: revoga a sessão atual.
- GET /super-admin/session: capability mínima, sem identidade/secret.
- GET /super-admin/overview: projeções agregadas, filtros e paginação.
- GET /super-admin/tenants/:id: mesmas projeções apenas para tenant alvo; auditado.
- GET /super-admin/health: estado Redis/worker e contadores das cinco filas fixas.

Interface `/super-admin`: visão geral, clínicas, uso de IA, integrações, jobs,
incidentes. O menu da home só aparece após capability positiva. UI não autoriza:
os guards e repository são obrigatórios mesmo sem interface.

## Acesso explícito a uma clínica — TASK-036

Na listagem de clínicas, o Super Admin pode informar o motivo e abrir uma clínica
ativa. O backend cria grant single-tenant com token aleatório, guarda somente hash,
expira em 30 minutos e limita a sessão atual a um tenant. Abrir outra clínica
revoga o grant anterior. Rotas clínicas continuam passando por AuthGuard,
TenantGuard, PermissionGuard e filtros dos repositories; no lugar de membership,
o contexto exige a relação do grant com a PlatformSession, usuário e tenant ativos.
As permissões são as do perfil CLINIC_ADMIN. Operações exclusivas da plataforma
continuam exigindo `@PlatformOnly`.

Uma faixa persistente mostra “Modo Super Admin”, nome da clínica e que leitura e
edição são auditadas. A saída revoga o grant; logout da plataforma revoga grants
ativos e limpa ambos os cookies. Audit registra início, fim, cada leitura e escrita
com user_id e actor_type PLATFORM_ADMIN, source PLATFORM, tenant, motivo, método e
rota normalizada. Dados de request/resposta e credenciais não entram nesses eventos.
O proxy web mantém allowlist explícita para os endpoints necessários. As interfaces
administrativas reutilizadas são as existentes no produto; módulos sem tela clínica
própria continuam sem interface até implementação de frontend correspondente.

## Métricas

Períodos TODAY, LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH e CUSTOM até366dias.
Datas civis inclusivas convertem para intervalo UTC semiaberto. Global usaUTC;
detalhe usa timezone do tenant. A série diária segue o mesmo timezone. Filtros de
nome/status/integração/atividade selecionam tenants antes de agregar; estado de
integração é atual. Atividade no período = mensagem, consulta ou AIUsage criados
no intervalo. Plano não existe no modelo e não é inventado.

- tenants/active/suspended: quantidade de tenants, por status administrativo atual.
- users: identidades distintas ACTIVE com membership ativo no conjunto selecionado.
- totalUsers: identidades distintas vinculadas, incluindo inativas.
- users por clínica/role: memberships ativos de identidades ACTIVE; somar roles ou
  clínicas pode duplicar identidade multi-clínica. A métrica global não duplica.
- units: quantidade de unidades cadastradas no conjunto, incluindo inativas.
- conversations/messages/appointments: registros criados no intervalo. Estados são
  os estados atuais da coorte, não eventos/transições ocorridos no período.
- IA: requests, input/output/total tokens informados, média de latencyMs não nula,
  erros, attempts e quantidade de requests sem totalTokens. Null é desconhecido;
  soma parcial não deve ser interpretada como consumo total medido. Sem custo estimado.
- Mensagens: distribuição senderType e deliveryStatus. PATIENT=inbound;
  AI/USER/SYSTEM=outbound. Não há ledger confiável de erros de webhook: indisponível.
- Calendar: distribuição de estados de sync, incluindo PENDING/PROCESSING e erros.
- failedIntegrations: configurações ERROR/DEGRADED; tenantsWithIncidents: tenants
  distintos com falha de integração atual ou erro IA/mensagem/sync na coorte.
- Última atividade: máximo de Message.createdAt, Appointment.createdAt, AIUsage.createdAt,
  sem alterar status administrativo automaticamente.

Listas limitadas a100 itens, padrão25; página até10000. Overview mantém totais
independentes da página; listas de uso/integrações/incidentes são paginadas. Uso
ordenado por requests, depois tenant/provider/model; clínicas por nome/id.

## Saúde e incidentes

Filas fixas: human-sla, calendar-sync, appointment-notifications,
conversation-engine, whatsapp-delivery. Apenas waiting/active/delayed/failed;
nunca job payload, failedReason, stack ou execução arbitrária. Filas não configuradas
podem estar vazias; zero não comprova consumidor conectado.

Worker publica heartbeat em Redis a cada15s comTTL60s. O sinal indica que ao menos
um processo worker executou recentemente o loop, não que todos os consumidores
estão saudáveis. Sem heartbeat ou sem Redis: UNKNOWN, estado geralCRITICAL. Jobs
falhos com heartbeat+Redis presentes:DEGRADED. Sem essas falhas:HEALTHY para os
componentes medidos. Provedores externos permanecemUNKNOWN. A leitura PostgreSQL
bem-sucedida comprova apenas aquela consulta; não há monitoramento externo contínuo.

Incidentes persistidos são agregados por tenant/subsistema: integrações ERROR ou
DEGRADED, mensagens FAILED e sync com erro =>CRITICAL; erros IA=>WARNING. Não são
alertas externos nem tickets; sem heurística de causalidade. Ausência de heartbeat
é exibida separadamente como incidente global. StatusACTIVE de integração é
configuração, não prova de conexão atual. lastTestedAt é tentativa de teste, não
“último sucesso”. Erros Calendar passam por allowlist; desconhecidos=>SYNC_ERROR.
WhatsApp ERROR/DEGRADED usa código genérico, sem fabricar causa ou timestamp.

## Minimização e performance

Somente IDs técnicos, nomes das clínicas, estados, contadores e datas. Nenhum nome
ou documento de paciente, conteúdo de mensagens, telefone, credentialsReference,
calendarId, settings, tokens ou chaves. A consulta seleciona projeções explícitas;
não carrega objetos administrativos completos para depois remover segredos.

SQL parametrizado, agregações noPostgreSQL e snapshotRepeatableRead. Número de
consultas constante, sem chamadas aos endpoints normais de cada clínica. A listagem
agrega apenas tenants da página. Índices decreated_at globais emconversations,
messages, appointments eai_usage complementam os existentes tenant+data. Tenant
possui status+name+id; sessão de plataforma temtokenHash único euserId+expiresAt.
Sem cópia de métricas ou cache global com dados sensíveis. Redis falhando não impede
abrir overviewPostgreSQL. Não há endpoint de SQL nem escolha arbitrária de fila.

## Limites da etapa

Consulta e investigação administrativa somente. Mutação de status depende de regra
completa de suspensão de ingressos/workers e não foi inventada. Sem billing, planos,
quotas, retry manual, impersonation, conteúdo clínico ou TASK-033.
