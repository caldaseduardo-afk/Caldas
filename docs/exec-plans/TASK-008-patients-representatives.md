# TASK-008 — Pacientes e representantes

## Objetivo e escopo

Patient e ContactPatient separados de Contact; cadastro/consulta/alteração de
paciente, gestão dos vínculos, principal e autorização explícita por contato.
Sem Conversation, Appointment, agenda, profissionais, serviços, IA ou TASK-009.

## Decisões de implementação

- Patient possui tenantId obrigatório, name, birthDate (data civil válida, não futura),
  document/healthPlan/paymentPreference/notes opcionais e timestamps. Não criar
  unicidade global de documento nem inferir identidade pelo nome/telefone. Um
  Contact existente liga-se ao Patient SELF, sem duplicar Contact.
- ContactPatient é N:N com IDs próprios, tenantId, os nove tipos documentados,
  estados DECLARED/VERIFIED/REVOKED e níveis FULL/SCHEDULING_ONLY/NO_ACCESS.
  Defaults: DECLARED, NO_ACCESS, active=true, principal/legal=false. Tipo, estado,
  nível, principal e representante legal não concedem autorização implicitamente.
- patient.view controla leitura administrativa no painel; patient.edit controla
  cadastro/alteração. Gerenciar/listar vínculos exige também contact.view.
  Nova patient.authorize exclusiva de CLINIC_ADMIN para verificar vínculo,
  conceder FULL/SCHEDULING_ONLY ou afirmar representante legal. Sem autorização
  automática por SELF/MOTHER/etc. AGENT pode declarar NO_ACCESS e revogar/restringir.
- DECLARED + SCHEDULING_ONLY é válido quando explicitamente autorizado; até VERIFIED
  + FULL não há leitura protegida pelo contato. DECLARED + FULL também não basta:
  conceitos independentes, ambos verificados pela política de leitura.
- Consultas /patients são administrativas por usuário do sistema autorizado,
  nunca porta de entrada de um contato externo. Leitura contextual
  /contacts/:contactId/patients/:patientId exige patient.view + contact.view,
  vínculo ativo VERIFIED/FULL e Contact ACTIVE, todos no tenant atual.
  Sem vínculo elegível/ID externo: 404 genérico; RBAC insuficiente: 403.
  Não há autenticação de contato nem API pública de pacientes nesta tarefa.
- PatientAccessService reutilizável prepara validação de futuro active_patient_id:
  revalidar vínculo em cada operação; não criar seleção global na sessão nem Conversation.
- Unicidade por tenant/contact/patient, preservando linha revogada; sem exclusão
  física. Revogação é terminal nesta entrega, não reativada por PATCH/POST. Novo
  consentimento após revogação exigirá política explícita futura, sem apagar histórico.
- Principal opcional (no máximo um vínculo ativo por paciente). Promoção troca
  atomicamente; revogar o principal deixa o paciente sem principal, sem escolher
  representante automaticamente. Principal/legal não substituem autorização.
- Alterar relationshipType invalida a declaração revisada: volta a DECLARED,
  NO_ACCESS e legal=false salvo decisões explícitas autorizadas na mesma requisição.
- authorizedBy/At e revokedBy/At são definidos no servidor e referenciam UserTenant
  do mesmo tenant. Auditoria atômica registra mudanças de política e atores; não
  replicar dados clínicos, documentos ou nomes nos eventos. Autorização de NO_ACCESS
  explícita também registra quem decidiu; defaults não fingem consentimento.
- DTOs por whitelist, limites e UUIDs; não aceitar tenant, IDs ou campos de auditoria.
  Responses usam selects/projeções explícitas. Lista/contexto de contato: id/name/
  birthDate; painel detalhado contém apenas campos editáveis do paciente. Vínculos
  expõem sua política/estado e datas, sem atores internos/tenantId/timestamps técnicos.
- Transações Serializable e filtros de autorização no SQL; lock do Patient para
  serializar principal/vínculos. Revogação, auditoria e mudanças são atômicas.

## Arquivos e banco

Novo módulo patients (DTOs, controllers/services/repositories de paciente/vínculo,
política de acesso contextual); schema/migration; catálogo e testes RBAC;
app.module; testes; documentação somente para essas decisões.

Migration nova aditiva: Patient, ContactPatient, enums RelationshipType,
RelationshipStatus, PatientAuthorizationLevel; FKs compostas para patient/contact
(e atores UserTenant), índices por tenant/patient/active e tenant/contact/active,
unique tenant/contact/patient e principal parcial, CHECKs de revogação/atores.
Nenhuma migration aplicada anteriormente será alterada.

## Riscos e critérios de aceite

Cobrir os 14 cenários solicitados: separação de entidades; N:N/SELF; IDs de outro
tenant na leitura/criação/alteração; NO_ACCESS e SCHEDULING_ONLY negados; DECLARED
não equivale a VERIFIED; revogação com histórico; principal consistente; responses
mínimas. Acrescentar RBAC contra autoelevação, CSRF/DTOs, constraints, concorrência,
revogação após captura de contexto e rollback de auditoria. Regressão TASK-003–007.

## Validações

pnpm db:generate; pnpm db:validate; pnpm lint; pnpm typecheck; pnpm test;
pnpm db:test; pnpm build; pnpm format:check; git diff --check.
Após PostgreSQL descartável: pnpm db:migrate; pnpm db:seed:rbac; migrate diff e smoke
local da API compilada. Não atualizar imagens Docker nem avançar TASK-009.

## Rollback

Desabilitar rotas novas se necessário. Preservar dados/migrations/auditoria.
Reversão de schema apenas com backup e migration compensatória revisada; nunca
retornar a uma versão que ignore autorização mantendo rotas expostas.

## Resultado

Em implementação.
