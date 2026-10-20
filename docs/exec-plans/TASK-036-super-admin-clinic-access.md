# Plano — TASK-036 Acesso de Super Admin às clínicas

## Objetivo

Permitir ao SUPER_ADMIN autenticado abrir uma clínica selecionada e usar as
rotas clínicas de leitura e edição sob um escopo temporário, com capacidades de
CLINIC_ADMIN. O ator continuará sendo o SUPER_ADMIN real; não haverá usuário
falso, membership clínico ou autorização determinada pelo frontend.

## Escopo

- Iniciar acesso a partir da clínica selecionada no painel Super Admin, exigindo
  motivo administrativo.
- Criar grant/cookie separado, temporário e limitado a um tenant; revalidar o
  PlatformAdmin, PlatformSession, estado do tenant e expiração em cada requisição.
- Reaproveitar somente rotas clínicas explícitas já permitidas pelo proxy e os
  mecanismos existentes de tenant/RBAC.
- Exibir um aviso persistente com clínica e ator; permitir encerrar o acesso.
- Auditar início/fim, leituras e escritas como `PLATFORM_ADMIN`, incluindo tenant,
  motivo, rota, correlação e resultado sem guardar conteúdo clínico desnecessário.
- Atualizar a documentação de segurança, multi-tenancy, Super Admin e o backlog.

## Arquivos afetados (previstos)

- `apps/api/src/auth/auth.guard.ts`
- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/tenancy/tenant.context.ts`
- `apps/api/src/permissions/authorization.service.ts`
- `apps/api/src/audit/audit-context.interceptor.ts`
- `apps/api/src/platform-admin/*`
- `apps/api/integration/platform.test.ts` e/ou nova suíte de integração
- `apps/web/components/platform/platform-dashboard.tsx`
- novo componente de faixa de acesso de plataforma em `apps/web/components/`
- `apps/web/app/layout.tsx`
- `apps/web/lib/proxy.ts` e testes correspondentes
- `packages/database/prisma/schema.prisma`
- nova migration em `packages/database/prisma/migrations/`
- `packages/database/src/audit.ts` e testes relacionados
- `BACKLOG.md`, `docs/security.md`, `docs/tenancy.md`, `docs/super-admin.md`

## Mudanças de banco

- Grant de acesso temporário referenciando o usuário, a sessão autenticada da
  plataforma e o tenant alvo; token somente como hash; motivo; criação, expiração
  e revogação.
- Novas ações de auditoria para início, término e leitura de acesso à clínica;
  novo tipo de ator `PLATFORM_ADMIN` e origem `PLATFORM`.
- Migration aditiva; não alterar migrations históricas nem aplicar a banco
  persistente durante a validação.

## Riscos e controles

- O acesso atravessa a fronteira global/clínica: aceitar apenas o cookie/grant
  emitido pelo backend após autenticação de plataforma; nunca confiar em
  `tenantId`, role ou flag do cliente.
- As permissões clínicas devem equivaler a CLINIC_ADMIN, enquanto endpoints
  exclusivos de plataforma continuam exigindo a sessão global.
- Atribuição de auditoria deve preservar o SUPER_ADMIN real em toda mutação;
  segredo, conteúdo de mensagens e dados clínicos não devem ir para metadata.
- O token de acesso deve expirar e ser revogável no servidor; sair, logout da
  plataforma, expiração ou revogação do PlatformAdmin devem invalidá-lo.
- A faixa de modo de acesso deve ser visível em todas as páginas clínicas.
- O proxy web continuará com allowlist de paths e métodos, sem encaminhamento
  arbitrário.

## Testes

- Plataforma sem membership abre um tenant permitido; um tenant arbitrário não.
- Usuário clínico não ativa nem usa o cookie de plataforma.
- Acesso segue permissões equivalentes a CLINIC_ADMIN e continua limitado ao
  tenant selecionado.
- Grant revogado/expirado, sessão global encerrada, SUPER_ADMIN desativado ou
  tenant inativo bloqueiam imediatamente.
- Início/término e leituras são auditados; mutações usam ator SUPER_ADMIN e
  origem PLATFORM sem perder os eventos específicos já existentes.
- Testar cookie HttpOnly, Origin/CSRF, proxy allowlist, troca de tenant, logout e
  faixa de encerramento da interface.
- Executar lint, typecheck, testes unitários, integração com PostgreSQL/Redis
  descartáveis e build.

## Critérios de aceite

- A partir da clínica no Super Admin, abrir a área clínica mostra claramente o
  tenant escolhido e libera consultas e edições previstas para CLINIC_ADMIN.
- O escopo não é confundido com sessão clínica normal nem com role de UserTenant.
- Nenhuma ação de negócio usa ou registra identidade de usuário clínico fictícia.
- Encerrar o acesso devolve ao painel da plataforma e torna o grant inválido.
- Testes de integração demonstram autorização, isolamento e auditoria.

## Rollback

- Desabilitar a operação de início e a leitura do cookie de tenant de plataforma.
- Manter a migration aditiva e os registros de auditoria/grants históricos;
  revogar grants ativos, sem excluir histórico.
- Não há mudança no contrato das sessões clínicas existentes.
