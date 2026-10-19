# Checklist de piloto controlado do MVP

Este checklist prepara um piloto, mas não declara autorização para deploy. O
status atual é `MVP NOT READY FOR PILOT`; os gates marcados como BLOCKING em
[MVP-FINAL-STATUS.md](MVP-FINAL-STATUS.md) precisam de evidência antes de usar
contas de teste externas ou dados de uma clínica.

## Before deployment

- [ ] Um tenant de clínica, uma unidade e usuários sintéticos com os menores
      papéis necessários (`CLINIC_ADMIN`, `AGENT`); registrar quem responde pela
      operação e pelo incidente.
- [ ] Somente contatos e pacientes sintéticos; usar número de teste/contatos
      autorizados. Não carregar prontuários nem pacientes reais nesta validação.
- [ ] Um usuário `SUPER_ADMIN` operacional, MFA/TOTP testado, recuperação e
      revogação ensaiadas; guardar chave MFA no secret manager.
- [ ] Habilitar WhatsApp e IA apenas após os gates de segurança, staging e smoke.
      Google Calendar é opcional; manter `DISABLED` se OAuth/conta de teste não forem
      validados.

### Ambiente e configuração

Todos os serviços devem vir de um runtime de produção imutável ou plataforma
equivalente aprovada. O `Dockerfile` e `compose.yaml` atuais são de desenvolvimento
e não são artefatos de piloto.

| Componente                 | Requisito de go-live                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                        | HTTPS; `API_INTERNAL_URL` privado; cookies Secure; sem segredo de provider no bundle.                                                                                                                                                    |
| API                        | `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` aleatório com pelo menos 32 caracteres, `AUTH_ORIGIN` HTTPS exata; headers, CORS, proxy confiável e WebSocket verificados no domínio.                                  |
| PostgreSQL                 | Versão compatível (17 validado localmente), TLS/rede privada, pool dimensionado, criptografia e backup externo com retenção aprovados. Aplicar migrations versionadas com `prisma migrate deploy`; não executar seed de desenvolvimento. |
| Redis                      | Rede privada, autenticação/TLS e política `noeviction`; health monitorado. PostgreSQL permanece fonte da verdade.                                                                                                                        |
| Worker                     | Mesmas URLs seguras de banco/Redis, `WORKER_CONCURRENCY` aprovado, heartbeat e filas observáveis; testar SIGTERM/restart.                                                                                                                |
| MFA de plataforma          | `PLATFORM_MFA_KEY` exclusiva de 32 bytes em base64 no secret manager; sem valor de desenvolvimento.                                                                                                                                      |
| WhatsApp (condicional)     | App secret, verify token, versão Graph, referência do token de acesso e número de teste; webhook HTTPS assinado e entrega/retorno comprovados. Credenciais apenas no secret manager.                                                     |
| IA (condicional)           | `OPENAI_API_KEY`, modelo allowlisted e limites/timeout definidos; fake provider ausente. Testar timeout, erro, handoff e conteúdo sintético.                                                                                             |
| Google Calendar (opcional) | Status `ACTIVE` somente após conta de teste e credencial segura validadas. Sem OAuth/credencial testada, manter `DISABLED`.                                                                                                              |

Variáveis condicionais e seus nomes estão listados em `.env.example`; arquivo
exemplo é documentação, não configuração pronta. Não copiar valores para logs,
browser ou relatório.

### Gates antes de receber mensagens

- [ ] acceptance E2E conectado WhatsApp → Conversation Engine → Tool Gateway →
      scheduling → Appointment → audit/outbox/Calendar/dashboard aprovado com dados
      sintéticos.
- [ ] smoke de Web/API com sessão real, perfis `CLINIC_ADMIN` e `AGENT`, além de
      teste de tenant sentinela.
- [ ] Workflow CI verde no commit candidato e regra de proteção de branch
      verificada.
- [ ] Scanner dedicado de segredos no checkout e histórico Git; resolver/rotacionar
      qualquer credencial encontrada.
- [ ] Logs correlacionáveis entre API e worker sem corpo de mensagem, telefone,
      conteúdo clínico ou segredo; retenção e operador definidos.
- [ ] Backup externo criptografado; restore real em destino isolado; RPO/RTO
      aprovados e cronometrados pelo responsável. O restore local descartável não
      substitui este gate.
- [ ] Runbook de incidentes, rollback da aplicação, migração compatível e
      recuperação Redis/PostgreSQL revisados por operador.
- [ ] Health, alertas e acesso a falhas de fila validados. `/health/live` indica
      processo; `/health/ready` verifica PostgreSQL e rate limit Redis; isso não
      comprova heartbeat do worker.

## Deployment

- [ ] Registrar commit e artefacto imutável usado em Web, API e Worker; registrar
      status das migrations antes/depois e procedimento de rollback compatível.
- [ ] Confirmar secrets e flags no secret manager, sem exportar valores para shell
      history, logs ou relatório.
- [ ] Habilitar somente integrações já validadas. Sem provider externo testado,
      usar apenas o fluxo local de acceptance com fakes e não chamar isso de deploy.

## After deployment

- [ ] Confirmar os três processos Web/API/Worker e versões em execução.
- [ ] Confirmar `/health/live`, `/health/ready`, Postgres/Redis e heartbeat/failed
      jobs por usuário autorizado.
- [ ] Registrar resultado e decidir go/no-go com operador responsável antes de
      receber mensagens externas.

## Smoke

### Procedimento sintético em staging

Executar sem dados de pacientes reais e guardar timestamps, commit e resultado sem
payload sensível:

1. Login `CLINIC_ADMIN`; verificar tenant e criar/verificar Unit, Service, Provider
   e Availability.
2. Receber webhook assinado no número de teste; reenviar o mesmo ID e confirmar
   idempotência. Conferir Contact, Conversation e Message persistidos.
3. Confirmar resposta da IA com conteúdo sintético; repetir pergunta fora da base e
   verificar fallback/handoff sem invenção.
4. Fazer busca de disponibilidade, criar HOLD e confirmar appointment após
   confirmação explícita. Conferir estado e audit.
5. Verificar Inbox como `AGENT`, executar handoff e confirmar que dois agentes não
   assumem a conversa simultaneamente.
6. Verificar notification/outbox sem duplicidade e estado da fila.
7. Se Calendar estiver habilitado, testar criação, atualização e reconciliação; se
   estiver desabilitado, confirmar `DISABLED` e `NOT_REQUIRED` conforme o caso.
8. Conferir dashboard e eventos de audit por tenant; confirmar que tenant sentinela
   não aparece em resultados.
9. Login `SUPER_ADMIN` com TOTP, revisar incidentes sem expor conteúdo de
   mensagens, e encerrar a sessão.
10. Aprovar go/no-go com responsável clínico e operador; caso contrário, desativar
    integrações e manter somente dados sintéticos.

Registrar o resultado em
[MVP-STAGING-SMOKE-REPORT.md](MVP-STAGING-SMOKE-REPORT.md), incluindo timestamp
UTC, SHA do commit, URL/identificador do ambiente sem credenciais, resultado de
cada check e correlation IDs sintéticos. Se staging não estiver provisionado,
marcar os checks como `NOT RUN` e manter o blocker; o teste local não o substitui.

## Monitoring

Durante o piloto, operador nomeado acompanha continuamente `/health/ready`,
heartbeat do worker, backlog/failed jobs, erros de webhook, erros/latência de AI,
erros de provider/Calendar, `AuditLog`, incidentes do Super Admin e anomalias de
tenant. Interromper entrada/automação e iniciar o runbook quando API/DB/Redis
ficarem indisponíveis, houver job repetido, appointment duplicado, falha de
assinatura, indício cross-tenant ou segredo/conteúdo sensível em logs.

### Kill switches disponíveis e limites

- IA/conversation engine: definir `CONVERSATION_ENGINE_ENABLED=false` na API e
  reiniciar a API; isso desliga o runtime automatizado, não apaga mensagens ou
  estado persistido. Confirmar no staging como ingressos ficam enfileirados durante
  a pausa antes do piloto.
- WhatsApp outbound: remover `WHATSAPP_GRAPH_VERSION` do ambiente do worker e
  reiniciá-lo para que o consumidor de envio não seja iniciado. O webhook da API
  usa sua própria configuração; avaliar mensagens pendentes antes de reativar.
- Google Calendar: alterar a integração para `DISABLED` com `settings.manage`; não
  apagar configuração ou sync ledger.
- Worker automation inteira: parar o worker e drenar com o procedimento operacional.
  Isso também pausa SLA, notificações, Calendar, expiração de HOLD e reconciliações;
  acompanhar impacto e não deixar a pausa sem operador.
- Não há, nesta versão, um kill switch único por tenant que pause todas as
  automações. Não editar diretamente o banco para improvisar um switch.

## Rollback

1. Desabilitar AI runtime e WhatsApp outbound pelos controles acima; quando a
   integridade estiver incerta, parar o worker e registrar a hora.
2. Manter PostgreSQL e ledgers; não apagar mensagens, appointments ou filas do
   banco. Não reenviar manualmente jobs sem conferir idempotency keys.
3. Reverter Web/API/Worker juntos para imagens imutáveis previamente aprovadas,
   compatíveis com o schema atual. Drenar/parar consumidores antes de trocar
   versões incompatíveis de job.
4. Não presumir rollback de migration. Preferir expand/contract; migration
   destrutiva exige restaurar backup validado em destino novo e cutover aprovado.
5. Para recuperar PostgreSQL, seguir [runbook de backup/restore](../runbooks/backup-restore.md),
   validar checksum/schema/tenant sintético e testar login, agenda e reconciliação
   em ambiente isolado antes de qualquer promoção.
6. Após rollback/restore, executar health, login por tenant, webhook deduplicado,
   leitura da agenda, fila e audit; registrar resultado sem segredos ou dados
   pessoais.
