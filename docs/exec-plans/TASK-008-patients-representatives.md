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
  - FULL não há leitura protegida pelo contato. DECLARED + FULL também não basta:
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

Concluída, sem avançar TASK-009.

### Arquivos da entrega

Módulo criado/concluído em apps/api/src/patients:

- patient.dto.ts e relationship.dto.ts: entradas por whitelist e validações;
- patient-access.ts: transações autorizadas, filtros e projeções;
- patient.repository.ts, patients.service.ts e patients.controller.ts: pacientes;
- relationship.repository.ts, relationships.service.ts e relationships.controller.ts: vínculos;
- patient-contact-access.repository.ts, patient-access.service.ts e patient-contact-access.controller.ts: política contextual;
- patients.module.ts: composição e exportação do serviço de acesso.

Novos testes: apps/api/test/patients.test.ts e apps/api/integration/patients.test.ts.
Migration: packages/database/prisma/migrations/20261001060000_patients_representatives/migration.sql.
Plano: este arquivo, criado antes da implementação.

Arquivos alterados na tarefa: packages/database/prisma/schema.prisma,
packages/database/src/rbac-catalog.ts, packages/database/test/integration.test.ts,
apps/api/src/app.module.ts, apps/api/test/bootstrap.test.ts, README.md,
docs/domain-model.md, docs/security.md e docs/tenancy.md. Os arquivos parciais do
módulo patients existentes na retomada foram completados, preservando tarefas anteriores.

### Validação executada

- pnpm db:generate e pnpm --filter @atendente/database build: client gerado.
- pnpm --filter @atendente/database exec prisma format: schema formatado.
- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script:
  migration gerada, revisada e acrescida de CHECKs/índice parcial antes da aplicação.
- pnpm lint: aprovado.
- pnpm typecheck: aprovado após corrigir fixtures de Tenant com status/timezone obrigatórios.
- pnpm test: 20 testes aprovados (API 15, database 3, web 1, worker 1).
- pnpm db:test: 2 testes de banco e 53 de integração da API aprovados, sem skips;
  migrations do zero/reaplicação e seed repetido aprovados em PostgreSQL 17 descartável.
  Inclui os 14 cenários solicitados distribuídos em 10 subtestes de pacientes,
  além de regressões de autenticação, tenancy, RBAC, clínicas/unidades e contatos.
- pnpm db:validate: aprovado.
- pnpm build: 7 tarefas aprovadas no monorepo.
- pnpm format:check e git diff --check: aprovados.
- pnpm db:migrate: migration TASK-008 aplicada ao banco local atendente_ia.
- pnpm db:seed:rbac: política aplicada; vínculos de usuários não alterados.
- pnpm --filter @atendente/database exec prisma migrate status: 7 migrations, sem pendências.
- pnpm --filter @atendente/database exec prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --exit-code: sem divergências no schema gerenciado
  pelo Prisma; CHECKs e índice parcial validados também pelos testes de banco.
- Smoke nativo com node --env-file=.env e apps/api/dist/bootstrap.js em porta efêmera:
  /health=200, /patients=401 e /contacts/:id/patient-links=401 sem sessão; processo encerrado.

### Limitações e pendências de escopo

Sem falhas de validação pendentes. Revogação é terminal; renovação de consentimento
não foi inventada. VERIFIED é decisão explícita de funcionário com patient.authorize,
não comprovação automática de identidade/documentação. SCHEDULING_ONLY é persistido,
mas nenhuma operação de agenda foi implementada. active_patient_id ainda não é
persistido, pois depende de Conversation futura; serviço contextual está preparado.
Não há frontend novo, integração externa, IA ou autorização clínica complexa.
Imagens Docker de aplicação não foram reconstruídas; executar código atualizado
com pnpm dev/build/start ou reconstruir as imagens quando necessário.
