# Runbook — resposta a incidentes

## Primeiros passos

1. Registre horário UTC, serviço/tenant afetado, sintomas e responsável; use canal
   operacional aprovado e evite copiar dados de pacientes para tickets públicos.
2. Preserve logs/auditoria necessários com acesso restrito. Não apague filas,
   banco, snapshots ou evidências antes de avaliar impacto.
3. Classifique severidade, impacto e início; comunique operador responsável e
   atualize o estado/mitigação no registro do incidente.
4. Corrija a causa, verifique recuperação por métricas/health e auditoria, e
   registre ações preventivas. Não execute replay de mutações sem idempotency key.

## Cenários

| Sintoma                                  | Ação imediata e recuperação                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL indisponível                  | `/health/ready` deve responder 503. Pare deploys/mutações, verifique cluster, pool e conexões; restaure serviço/backup conforme `backup-restore.md`. Não aceite writes sem persistência.                                                                               |
| Redis indisponível                       | Verifique API/worker e Redis; Appointments permanecem no PostgreSQL. Corrija conexão, depois permita reconciliation de filas. Não recrie envios manualmente sem conferir ledgers.                                                                                      |
| Worker parado                            | Verifique heartbeat, SIGTERM/OOM e failed jobs; reinicie com configuração validada e observe reconciliation de Calendar/notificações/SLA. Respeite janelas temporais e deduplicação.                                                                                   |
| OpenAI indisponível                      | Preserve inbound persistido; desative geração automática se necessário, mantenha handoff/fallback seguro e não regenere mensagens outbound. Verifique código de erro/timeout sem expor prompt/token.                                                                   |
| WhatsApp indisponível                    | Preserve Message/outbox e status, confira falha permanente versus transitória/resultado incerto. Retry é limitado e reconciliação deve reutilizar a Message existente; evite duplicação externa.                                                                       |
| Google Calendar indisponível             | PostgreSQL é fonte da consulta. Mantenha sync pendente/erro para reconciliação, corrija credencial/configuração e não cancele Appointment por falha externa.                                                                                                           |
| Webhook suspeito/assinado incorretamente | Confirme HMAC e bytes originais, preserve métricas/correlation ID; payload rejeitado não deve criar conversa/mensagem nem acionar IA. Rotacione segredo somente após verificar a configuração com o provedor.                                                          |
| Suspeita de acesso cross-tenant          | Limite acesso operacional, preserve logs/audit, identifique IDs/tenants afetados com acesso restrito, revogue sessões/credenciais quando necessário e corrija autorização antes de reabrir.                                                                            |
| Suspeita de segredo exposto              | **Revogue imediatamente**, emita novo segredo, atualize secret manager/ambientes, reinicie ou redeploy dependentes, confira logs e acessos desde a exposição, audite impacto e registre a rotação. Remover do arquivo atual não revoga credencial nem limpa histórico. |

## Fechamento

Registre causa raiz, intervalo afetado, dados/tenants potencialmente envolvidos,
IDs de deploy, rotação executada, recuperação validada e ações com responsável e
prazo. Reveja retenção e comunicação externa conforme política da clínica e
obrigações aplicáveis.
