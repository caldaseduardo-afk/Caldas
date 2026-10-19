# MVP — problemas conhecidos do Release Candidate

Reavaliado em 2026-10-18 durante o fechamento dos gates do MVP. A decisão atual
continua **MVP NOT READY FOR PILOT** até a infraestrutura externa, CI remota,
proteção de branch e smoke HTTPS serem comprovados. Ver
[MVP-FINAL-STATUS.md](MVP-FINAL-STATUS.md) e
[MVP-PILOT-CHECKLIST.md](MVP-PILOT-CHECKLIST.md).

## BLOCKING

### Staging, deploy e smoke da Web/API

- **Evidência local:** acceptance conectado usa API Nest/HTTP real, PostgreSQL 17,
  Redis 7.4, AI fake, Tool Gateway, agenda, audit e worker BullMQ. O teste cobre
  health/ready e isolamento; não inicia o frontend Web nem testa domínio HTTPS.
- **Falta:** staging provisionado, artefatos/runtime de Web/API/Worker, credenciais
  sintéticas de provider, smoke com sessão real e callback/entrega externa.
- **Ação:** provisionar ambiente aprovado; executar os checks de
  `MVP-PILOT-CHECKLIST.md` e guardar o relatório sem payload pessoal.

### CI e proteção da branch principal

- **Evidência local:** `.github/workflows/ci.yml` contém install congelado,
  Gitleaks, audit, Prisma validate, lint, typecheck, testes, migrações de teste,
  browser E2E e build. GitHub informou `main` sem proteção e nenhum workflow/run
  visível no remoto.
- **Falta:** workflow publicado no candidato, run verde e status checks marcados
  como obrigatórios em `main`.
- **Ação:** publicar o candidato conforme processo do repositório; depois exigir o
  check `verify` na proteção da branch e verificar configuração/run. Não exigir
  check antes de ele existir no remoto.

### Runtime de produção

- **Evidência local:** `pnpm build` e comandos package `start` existem para Web,
  API e Worker. O Dockerfile atual termina em `pnpm dev`; Compose/Docker não são
  runtime de produção. Não foi selecionada plataforma ou forma de deploy.
- **Falta:** runtime imutável e aprovado por serviço, ambiente/secrets/health,
  migração controlada e rollback ensaiados no destino real.
- **Ação:** selecionar/provisionar runtime; validar start/health/rollback de Web,
  API, Worker, PostgreSQL e Redis nesse ambiente. Build local não fecha este gate.

### Backup externo e recuperação

- **Evidência local:** PostgreSQL 17 descartável recebeu 35 migrations, dump
  custom e restore para outro database com tenant sintético (execução anterior,
  2026-10-18). Nenhum armazenamento externo foi usado.
- **Metas propostas:** RPO ≤ 24 h com backup diário criptografado e cópia externa
  concluída/monitorada; RTO ≤ 4 h como TARGET. Ambos exigem aprovação do operador.
- **Falta:** provedor/destino, região, criptografia/gestão de chaves, retenção,
  frequência, dono operacional, restore externo cronometrado e ponto de recuperação
  demonstrado. RPO/RTO não foram medidos.

## RESOLVED localmente — scan de secrets

- **Evidência:** Gitleaks 8.24.2 em container por digest analisou todo o histórico,
  patch rastreado local e arquivos novos de readiness/ignore. O histórico
  inicialmente acusou uma constante
  `AUTH_SECRET` no teste `apps/api/test/rate-limit.test.ts:8`; revisão confirmou
  que é fixture e não credencial operacional. O fingerprint exato está em
  `.gitleaksignore`; novo scan histórico e scan do diff tiveram zero findings.
  `.github/workflows/ci.yml` agora repete o scan em CI. O workflow ainda precisa
  executar remotamente no candidato, conforme o blocker de CI acima. Nenhuma
  credencial real foi confirmada; nenhum segredo foi impresso.

## BLOCKING — Isolamento de tenant e autorização em staging

- **Evidência local:** acceptance e regressões integradas validam ID conhecido de
  outro tenant como 404, sem mutação/audit/evento indevido; RBAC, webhook e Tool
  Gateway também têm testes de integração.
- **Falta:** smoke da mesma fronteira contra o runtime Web/API implantado.
- **Ação:** executar fluxo Tenant A/Tenant B no staging com dados sintéticos e
  guardar status, sem copiar IDs de pacientes ou payloads.

## RESOLVED localmente; staging ainda requerido

### Fluxo conectado API → Appointment → Worker/Notification

- `apps/api/integration/pilot-acceptance.test.ts` cobre webhook HMAC, Contact,
  Conversation, Message, AIProvider substituído por FakeAIProvider, Engine,
  Tool Gateway, Patient/Service/Availability, HOLD, confirmação, Appointment,
  auditoria, notification scheduling/worker, webhook duplicado, handoff/claim e
  isolamento cross-tenant. O resultado da última execução completa está em
  `MVP-FINAL-STATUS.md`.
- O teste é local e determinístico; não comprova envio WhatsApp real ou UI Web.

### Logs e correlação

- Testes verificam allowlists dos loggers de messaging/notification, ausência de
  sentinelas de senha/token/cookie/segredo e propagação do correlation ID do
  webhook para audit, run/uso de IA, log do Engine e audit da consulta.
- O acceptance valida correlação sem persistir conteúdo de mensagem nos logs. A
  infraestrutura de coleta/retenção e operador do staging ainda não existem.

## DEFERRED sob condições

### Google Calendar OAuth/refresh

Permitido somente com integração `DISABLED` e `calendar_provider = NOT_REQUIRED`
no piloto. Ativar Google torna OAuth/refresh/reconciliação real um gate anterior à
ativação.

### Performance e escala

Permitido apenas para piloto pequeno, com limites e paginação existentes e uma
instância observada. Não escalar horizontalmente até medir latência, filas e
rate-limit compartilhado.

### SIGTERM/outage com efeito externo ativo

Retries, idempotência e recovery de Redis/outbox têm testes; interrupção real
durante um efeito externo não foi ensaiada. Permitido apenas com operador presente
monitorando worker/failed jobs e suspendendo automações em anomalia.
