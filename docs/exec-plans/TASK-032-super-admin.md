# TASK-032 — Super Admin

## Objetivo
Área operacional de plataforma, separada do dashboard de clínica: tenants,
usuários agregados, volume, uso IA, mensageria, integrações, filas e incidentes.
Não iniciar TASK-033, billing, impersonation ou acesso a conteúdo de pacientes.

## Dependência de segurança — decisão resolvida
`docs/security.md` exige MFA completo para SUPER_ADMIN. O usuário delegou a
escolha da alternativa mais simples: TOTP local com aplicativo autenticador,
sem nova integração externa. A concessão global, o enrollment confirmado e a
sessão verificada serão requisitos de acesso; flags de UserTenant não bastam.
Detalhes e proteção contra replay estão na decisão ao final deste plano.

## Plano
1. Mapear dados existentes e definir KPIs/projeções explícitas.
2. Criar autorização de plataforma dedicada com MFA TOTP: concessão global
   distinta de UserTenant, sessão verificada e contexto criado no backend.
3. Implementar repository/query service de plataforma com agregações SQL/Prisma
   parametrizadas, período máximo 366 dias, paginação até 100 registros.
4. Implementar health encapsulado: contadores BullMQ por nomes fixos e heartbeat
   worker com TTL em Redis. Nunca devolver payload, failedReason ou stack do job.
5. Criar UI `/super-admin`, capability obtida do backend, filtros e seções
   independentes para falha parcial de Redis não derrubar métricas PostgreSQL.
6. Adicionar testes de escopo, minimização, agregação, health, UI e três E2Es pedidos.
7. Validar migrations, lint, typecheck, testes, integração e build.

## Decisões de domínio
- Platform scope identifica ator global; targetTenantId identifica recurso consultado.
  Não existe tenant ativo obrigatório nem opção skipTenantCheck em repository comum.
- Status Tenant é String no schema. ACTIVE é o único estado operacional permitido;
  INACTIVE já existe. SUSPENDED pode ser exibido quando cadastrado, sem introduzir
  mutação/suspensão até definir comportamento completo em todos os ingressos/filas.
  Conforme seção 37 do pedido, gestão inicial é consulta administrativa; não apagar,
  promover, reativar ou suspender tenants por inferência de atividade.
- Sem retry manual de jobs, impersonation, alteração de modelos IA ou leitura clínica.
- Visitas a detalhe de tenant serão auditadas com ator real e target tenant, conforme
  tenancy.md. Consultas agregadas globais terão log técnico mínimo de ação/duração.

## Métricas e projeções
- Visão global UTC, presets e CUSTOM com datas inclusivas convertidas para UTC
  semiaberto. Detalhe individual usa timezone do tenant. Estado de integração/filas
  é “agora”, separado do volume do período.
- Conversations, Messages e Appointments por created_at; estados são status atual
  desses registros. Não confundir com agenda por start_at da TASK-031.
- Usuários globais são identidades distintas; por tenant são memberships ativos
  de usuários ACTIVE. Um usuário multi-clínica não duplica no total global.
- AIUsage conta requests, input/output/total tokens registrados, média latencyMs,
  status de erro, provider/model e tenant; tokens null são desconhecidos, não estimar
  preços/custos nem consumo ausente. Distribuição/listas limitadas e paginadas.
- Última atividade = maior timestamp persistido de Message.createdAt,
  Appointment.createdAt e AIUsage.createdAt. Não alterar status por inatividade.
- WhatsApp inbound = PATIENT, outbound = AI/USER/SYSTEM; usar deliveryStatus real.
  Erros de webhook sem ledger persistido ficam indisponíveis, não retornar zero falso.
- Integrações retornam apenas tenant/nome/tipo/status/timestamps técnicos/código
  permitido. Omitir credentialsReference, settings, calendarId, phoneNumberId,
  externalAccountId, tokens, chaves e payloads.
- Incidentes derivados de estados existentes: integração ERROR/DEGRADED, falhas de
  sincronização/envio/IA, filas failed e heartbeat ausente. Sem alegar saúde real de
  provedor remoto a partir de mera configuração ACTIVE; usar UNKNOWN quando não medido.

## Arquivos previstos
`apps/api/src/platform-admin`, componentes/rotas web correspondentes,
contratos em packages/types, módulo de health compartilhado em packages/database,
heartbeat no worker, testes API/DB/web, documentação de plataforma e segurança.
Arquivos de autenticação/schema/migrations seguem a decisão TOTP registrada abaixo.

## Banco, índices e performance
Sem tabela duplicada de métricas. Avaliar índices globais created_at para volumes
que atualmente só têm tenant_id como prefixo; índices por status existente reutilizados.
Listagem usa agregações/join em conjunto, não uma consulta por tenant. Modelos de
credencial/concessão de plataforma serão especificados conforme decisão TOTP abaixo.

## Riscos e critérios de aceite
Nenhuma credencial, conteúdo de mensagens ou identificador de paciente em respostas,
logs ou incidentes. Escopo global nunca vem do cliente. Usuários clínicos recebem403,
anônimo401; grant/sessão/MFA revogados bloqueiam. Detalhe B nunca agrega A.
Fixture A/B/C: 3 tenants, 2 ACTIVE, 1 SUSPENDED, 150 mensagens, 28 conversas,
15 consultas e 15000 tokens; Tenant B gera incidentes. Testar estado vazio,
paginação, período, SQL injection, health expirado e ausência de secrets.

## Comandos de validação
`pnpm db:validate`, `pnpm db:migrate`, `pnpm db:test`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, testes Playwright específicos e `pnpm build`.

## Rollback
Desregistrar módulo/rotas UI de plataforma; preservar o histórico de auditoria.
Índices aditivos podem permanecer. Não remover dados clínicos ou migrations aplicadas.
Nunca liberar acesso sem MFA como forma de rollback.

## Decisão de autenticação — 2026-10-17
O usuário delegou a escolha da alternativa mais simples. Adotar TOTP conforme
RFC 6238 (30s, seis dígitos, janela ±1, HMAC-SHA1 com testes de vetores RFC).
Concessão PlatformAdmin global separada de UserTenant, enrollment por convite
administrativo de uso único e senha existente, confirmação TOTP antes de ativar.
Secret cifrado AES-256-GCM com chave exclusiva PLATFORM_MFA_KEY; nenhuma chave
padrão. Login de plataforma exige senha + TOTP, contador monotônico anti-replay,
rate limit persistente e sessão/cookie próprios (1h, HttpOnly/SameSite/Secure).
Sessão clínica não autoriza plataforma, nem sessão de plataforma autoriza clínica.
Recuperação é novo convite administrativo com revogação de sessões e credencial
anterior; não haverá bypass HTTP de MFA ou cadastro público de superadmins.
Provisionamento/revogação é comando operacional explícito, não seed automático.
Fonte: https://www.rfc-editor.org/rfc/rfc6238
