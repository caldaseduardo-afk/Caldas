# MVP — problemas conhecidos do Release Candidate

Reavaliado em 2026-10-18 no checkout local. TASK-035 recebeu `MVP RC BLOCKED`.
Nenhuma falha local de engenharia foi relatada naquela execução. Este fechamento
adicionou um ensaio descartável de dump/restore (35 migrations e tenant sintético
restaurado); não houve alteração de código ou migration. O relatório atualizado
está em [MVP-FINAL-STATUS.md](MVP-FINAL-STATUS.md).

## BLOCKER

### BLOCKING — falta acceptance E2E conectado do inbound ao resultado

- **Área:** WhatsApp, Conversation Engine, AIProvider/Tool Gateway, scheduling, Appointment, outbox/notifications, Calendar e dashboard.
- **Evidência:** `pnpm db:test` passa 303 integrações. `ai-scheduling.test.ts` cobre scheduling/coordinator com DB real; `whatsapp.test.ts` cobre webhook, persistência e processamento; Calendar, notifications e dashboard têm suites próprias. Nenhum executa a mensagem pelo runtime do engine até envio e projeções.
- **Estado:** BLOCKING. Os ensaios de webhook, engine, scheduling e projeções continuam em suítes separadas; este fechamento não adicionou um aceite único conectado.
- **Ação:** executar acceptance E2E determinístico em PostgreSQL/Redis que correlacione a mensagem até Appointment, audit, outbox, Calendar e dashboard; em seguida executar o smoke sintético em staging.

### BLOCKING — providers e deployment real não foram validados em staging

- **Área:** WhatsApp, AI, Google Calendar, HTTPS e entrega.
- **Evidência:** providers são fakes/controlados nas suites; não houve callback Meta, AI de staging, Google Calendar real ou deploy no domínio HTTPS.
- **Estado:** BLOCKING. Nenhum staging, domínio HTTPS, conta de teste ou credencial foi disponibilizado; não há evidência de callback ou entrega real.
- **Ação:** testar contas/credenciais sintéticas e confirmar callback, entrega, retries/idempotência, WebSocket e ausência de secrets em logs. Não usar dados reais.

## HIGH

### BLOCKING — backup externo e metas RPO/RTO sem ensaio

- **Área:** PostgreSQL e recuperação.
- **Evidência:** nesta revisão, PostgreSQL 17 efêmero recebeu 35 migrations, foi feito dump custom e o restore em database isolado recuperou o tenant sintético. Não foi usado backup externo, e RPO/RTO não foram medidos; o restore local não representa dados ou topologia do piloto.
- **Estado:** BLOCKING para dados de piloto até o operador configurar cópia externa criptografada, aprovar metas e registrar restore ensaiado com duração/ponto de recuperação.

### BLOCKING — runtime de produção não existe no Docker atual

- **Área:** deploy.
- **Evidência:** `Dockerfile`/`compose.yaml` são dev-only (`pnpm dev`). `pnpm build` passa, mas não há artefato runtime production imutável por serviço.
- **Estado:** BLOCKING para deployment por Docker. `Dockerfile`/Compose permanecem voltados a desenvolvimento; build local não valida processo runtime por serviço.
- **Ação:** criar/validar artefatos Web/API/Worker e topologia com non-root, secrets, TLS, health checks e rollback antes de deploy Docker.

### BLOCKING — CI remota/branch protection não comprovadas

- **Área:** release process.
- **Evidência:** `.github/workflows/ci.yml` existe e comandos locais passaram; run no GitHub e proteção de branch não foram observados.
- **Estado:** BLOCKING para congelar/liberar candidato. A consulta anterior ao GitHub retornou zero runs visíveis; regras de proteção não foram verificadas.
- **Ação:** rodar workflow no commit candidato e configurar regras obrigatórias antes do piloto.

### DEFERRED — OAuth Google e rotação não validados

- **Área:** Google Calendar.
- **Evidência:** testes cobrem provider com credencial configurada/referenciada; não há state/callback OAuth interativo nem rotação automática de refresh token, conforme checklist TASK-034.
- **Estado:** DEFERRED somente se Google Calendar permanecer desativado no piloto. Se habilitado, torna-se BLOCKING até validar credenciais, callback/renovação e reconciliação em conta de teste.
- **Ação:** manter a integração desativada ou provisionar/testar o método seguro suportado antes de habilitá-la.

## MEDIUM

### BLOCKING — logging/redaction não é uniforme entre API e Worker

- **Área:** observabilidade.
- **Evidência:** IDs de correlação e logs estruturados existem em partes; TASK-034 registra ausência de logger/pipeline uniforme e redaction/correlation API→worker.
- **Estado:** BLOCKING enquanto mensagens de teste forem recebidas, pois ainda não há evidência consolidada de correlação e redaction ponta a ponta.
- **Ação:** demonstrar correlação entre API/worker sem payload, telefone, credencial ou conteúdo clínico em logs; definir retenção e responsável operacional.

### BLOCKING — Browser E2E não usa API real

- **Área:** Web/Realtime.
- **Evidência:** 25 testes Playwright passaram com mocks, mas `/realtime` devolveu `ECONNREFUSED localhost:3001`; 21 testes API WebSocket real passaram separadamente.
- **Estado:** BLOCKING até smoke manual/browser contra Web/API de staging, com sessão real e perfis clínicos sintéticos.
- **Ação:** rodar smoke browser contra Web/API de teste com sessão real antes do piloto.

### DEFERRED — crash/shutdown e recuperação de outage ainda são testes separados

- **Área:** Worker/API/providers.
- **Evidência:** retries, Redis vazio/outbox, handlers SIGTERM e falhas de providers cobertos separadamente; sem processo encerrado durante efeito externo/job ativo e verificação de toda a cadeia.
- **Estado:** DEFERRED para piloto restrito a uma clínica, condicionado a operador acompanhando worker/failed jobs e suspendendo automações se houver anomalia. Tornar BLOCKING antes de ampliar escala ou automatizar além desse limite.
- **Ação:** ensaiar SIGTERM, restart, backlog e outage/recovery em staging conferindo ledger e efeitos duplicados.

### BLOCKING — secret scan não certifica histórico Git

- **Área:** supply chain.
- **Evidência:** busca textual atual não encontrou segredo real; `sk-test-only-not-a-real-key` em teste é fixture. `gitleaks` e scanner de histórico não estão disponíveis.
- **Estado:** BLOCKING antes de inserir qualquer credencial real. A revisão textual não substitui scanner dedicado/histórico; `gitleaks` e `trufflehog` não estão instalados neste ambiente.
- **Ação:** executar ferramenta dedicada no histórico/branch; rotacionar credencial real imediatamente se encontrada.

### DEFERRED — sem budget de performance ou rate limit multi-instância

- **Área:** carga/API.
- **Evidência:** paginação, agregados, slots e rate limit Redis single API foram exercitados; sem benchmark, metas de latência ou teste multi-instância.
- **Estado:** DEFERRED apenas para piloto pequeno, com uma instância de API e limites operacionais monitorados; não habilitar escala horizontal antes de medir rate limit compartilhado, latência e carga.
- **Ação:** medir webhook ACK, slots/dashboard e tráfego interno em staging com volume sintético e duas instâncias antes de expansão.

## LOW

Nenhuma pendência LOW adicional foi necessária para a decisão desta execução.
