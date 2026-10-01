# TASK-006 — Clínicas e unidades

## Objetivo e escopo

Implementar cadastro, consulta, alteração e inativação de clínicas/unidades usando
Tenant e Unit existentes, contexto da TASK-004 e RBAC da TASK-005. Sem contatos,
pacientes, escopo USER_UNIT, UI ou TASK-007.

## Decisões e ambiguidade registrada

- Leituras exigem tenant.view/unit.view. Alterações de configuração e unidades
  exigem settings.manage, já atribuído somente a CLINIC_ADMIN. Não mudar matriz.
- Tenant é a clínica. Unidade pertence imutavelmente ao tenant da sessão; DTOs
  nunca aceitam tenantId, IDs, role ou timestamps controlados pelo cliente.
- Consulta de clínicas pela API limita-se ao tenant selecionado, mesmo se o usuário
  tiver outros vínculos. A listagem de seleção /tenancy/tenants continua existente.
- Criação de nova clínica cruza a fronteira de provisionamento da plataforma. A
  documentação não concede isso a CLINIC_ADMIN, e SUPER_ADMIN requer MFA ainda
  ausente. Pergunta enviada ao usuário: provisionamento local de desenvolvimento
  ou autorização explícita para CLINIC_ADMIN criar clínica com vínculo próprio.
  Sem nova autorização de plataforma definida, preservar a alternativa mínima:
  criação pelo comando local clinics:create, somente development, com proprietário
  existente e vínculo CLINIC_ADMIN apenas na nova clínica. Não há POST /clinics.
  Não interpretar settings.manage como permissão de criar tenants externos.
- DELETE significa inativar, preservando vínculos e histórico. Tenant.status usa
  ACTIVE/INACTIVE na API; sem converter valores legados ou introduzir estados de
  faturamento. Clínica inativa perde acesso/contexto conforme TASK-004; reativação
  administrativa de clínica permanece fora desta API, sem contornar TenantGuard.
- Unit.active representa status no modelo atual. timezoneOverride nulo herda
  timezone da clínica; expor effectiveTimezone na API de unidades. Nome e endereço
  obrigatórios e limitados; timezone validado pelo runtime IANA/Intl. PATCH parcial
  não aceita payload vazio, null indevido, tipos errados ou campos extras.
- Módulos clinics e units com controllers/services/repositories próprios. Preservar
  rotas de metadados /tenancy/* como compatibilidade, reutilizando repository.
- Guard, service e repository exigem permissões. Leituras/updates filtram tenant,
  sessão e permissão no SQL. Escritas em transação Serializable com revalidação,
  auditoria atômica e erro 409 se ocorrer conflito concorrente, sem sucesso parcial.
- Auditoria mínima reutiliza AuthEvent: adicionar tipos de operações e campos
  opcionais resourceId/changes, sem criar a infraestrutura completa da TASK-030.
  Somente dados de configuração envolvidos; nunca tokens/senhas.
- Manter CSRF para POST/PATCH/DELETE; incluir métodos novos no CORS existente.

## Arquivos afetados

apps/api/src/clinics, units e validação compartilhada; app.module, tenancy e CORS;
schema/migration de AuthEvent; testes unitários/integração; README, documentos de
segurança/domínio/tenancy e este plano. Scripts de provisionamento se aplicável.

## Banco

Reutilizar Tenant/Unit e constraints existentes. Migration aditiva em AuthEvent
para auditoria de configuração; revisar SQL antes de aplicar. Sem reset, DROP ou
exclusão física. Atualização de recurso e auditoria na mesma transação.

## Riscos e critérios de aceite

- Criação não pode conceder acesso implícito a clínicas existentes.
- IDs de outro tenant jamais permitem leitura/alteração/inativação, mesmo por admin.
- AGENT/DOCTOR podem ler metadados, mas alterações retornam 403.
- Sem sessão: 401; sem tenant/permissão: 403; ID externo/inexistente: 404.
- Múltiplas unidades com endereço, estado, timezone herdado/sobrescrito.
- Testes HTTP de criação, consulta, PATCH, DELETE/inativação, DTOs, CSRF, auditoria,
  rollback, chamadas diretas e revogação entre validação e escrita.
- Regressão de auth/RBAC/tenancy; não ampliar para TASK-007.

## Comandos de validação

pnpm lint; pnpm typecheck; pnpm test; pnpm db:test; pnpm build;
pnpm format:check; pnpm db:validate; git diff --check. Aplicar migration local após
validação em banco descartável e comparar schema com Prisma. Verificar API compilada.

## Rollback

Preservar migrations/dados. Desabilitar rotas novas em rollback de aplicação;
não retornar a autorização anterior que ignore RBAC. Reversão de schema exige
backup e migration compensatória; não apagar auditoria ou volume de banco.

## Resultado

Implementado o escopo mínimo compatível com as permissões existentes. Criação de
clínicas via clinics:create em desenvolvimento; consulta/alteração/inativação da
clínica selecionada por HTTP; CRUD de unidades por HTTP, incluindo inativação.
Provisionamento de novas clínicas por HTTP não foi liberado sem uma permissão de
plataforma definida. Essa limitação e o comando local estão no README.

### Arquivos criados e reorganizados

- apps/api/src/clinics: clinic.dto.ts, clinic.repository.ts, clinics.service.ts,
  clinics.controller.ts, clinics.module.ts, development-provisioning.ts, create-clinic.ts;
- apps/api/src/units: unit.dto.ts, units.service.ts, units.controller.ts, units.module.ts;
- UnitRepository movido de tenancy para units/unit.repository.ts e reutilizado pelas rotas antigas;
- apps/api/src/configuration/dto.ts e configuration-write.ts;
- apps/api/test/clinics-units.test.ts e apps/api/integration/clinics-units.test.ts;
- packages/database/prisma/migrations/20261001040000_clinics_units_audit/migration.sql;
- este plano.

Módulos/imports, CORS, schema de AuthEvent, scripts e documentação atualizados.
Não houve alteração de matriz RBAC. Writes copiam apenas campos editáveis também
no repository: nem um caller interno com DTO contendo tenantId pode mover uma
unidade. Teste direto detectou e validou essa defesa adicional. Ajustada a
validação de caracteres de controle para satisfazer lint sem desabilitar regra.

### Validações

Migration revisada, testada do zero em banco descartável e aplicada no banco local:
somente seis valores no enum de eventos e duas colunas opcionais; sem DROP/reset.
Prisma validate e migrate diff aprovados, sem divergência. Instalação com
--frozen-lockfile aprovada. Validações finais aprovadas após a correção:

- pnpm lint;
- pnpm typecheck;
- pnpm test (11 testes da API, mais testes dos demais pacotes);
- pnpm db:test (dois testes de banco, 28 cenários em quatro suítes da API, 32 registros TAP contando suítes);
- pnpm build;
- pnpm format:check e git diff --check;
- pnpm db:validate e comparação Prisma sem drift;
- pnpm install --frozen-lockfile.

Smoke da API compilada contra ambiente local: /health 200, /clinics 401 e /units
401 sem sessão. A instância temporária foi encerrada. Testes autenticados completos
rodaram com PostgreSQL descartável, incluindo rollback e isolamento nas duas direções.
Não houve atualização da imagem Docker nesta tarefa. TASK-007 não iniciada.
