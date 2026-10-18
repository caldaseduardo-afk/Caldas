# MVP — checklist de implantação controlada

Este checklist prepara a implantação, não autoriza deploy. O candidato está **BLOCKED** até fechar os itens em `MVP-KNOWN-ISSUES.md`.

## Configuração por serviço

Secrets devem vir do secret manager e nunca ser embutidos na imagem ou no bundle Web. `.env.example` e `compose.yaml` são referências de desenvolvimento.

| Serviço     | Configuração                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web         | `API_INTERNAL_URL` privado para API; origem HTTPS configurada para login. Não expor segredo de provider, auth ou DB ao browser.                                                                              |
| API         | `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` com 32+ caracteres e `AUTH_ORIGIN` HTTPS exata. Para recursos ativados, configurar OpenAI/model allowlist e segredos/referências WhatsApp. |
| Worker      | `DATABASE_URL`, `REDIS_URL`, `WORKER_CONCURRENCY`; credenciais/referências WhatsApp de saída e credenciais Calendar só quando ativados. Fakes nunca em produção.                                             |
| Super Admin | `PLATFORM_MFA_KEY` exclusiva, 32 bytes em base64 via secret manager; provisionar convite por operador real e testar TOTP.                                                                                    |
| PostgreSQL  | Versão 17 compatível, TLS, criptografia em repouso, pool dimensionado, backup externo e retenção aprovados.                                                                                                  |
| Redis       | Versão 7.4 ou compatível, privado/autenticado/TLS, `noeviction`; API e worker compartilham serviço configurado. Não é fonte de dados de negócio.                                                             |

Conferir validadores de configuração no commit candidato e documentar variáveis condicionais de cada provider. Não tomar Compose local como topologia de produção.

## Gates pré-deploy

- Fechar todos os itens BLOCKER/HIGH e anexar evidência de staging; confirmar CI verde no commit candidato, branch protection, `pnpm audit` e secret scan do histórico Git.
- Criar imagens/artefatos runtime imutáveis de produção Web/API/Worker. O Dockerfile atual é de desenvolvimento; não usá-lo como imagem de serviço em produção.
- Validar domínio HTTPS, proxy, CSP/HSTS, CORS, cookies Secure/`__Host-`, Origin e WebSocket upgrade. Configurar explicitamente proxies confiáveis; não aceitar `X-Forwarded-For` genérico.
- Ensaiar upgrade de migrations num banco isolado com snapshot representativo; registrar compatibilidade, duração e locks. Não rodar seed de desenvolvimento.
- Confirmar backup criptografado fora do cluster, fazer restore em destino novo e registrar RPO/RTO observados antes de receber pacientes.
- Configurar WhatsApp webhook HTTPS, app secret/verify token, phone number e integração por tenant; executar smoke de envio/retorno em conta de teste.
- Configurar AI com credencial segura/modelo permitido e testar conteúdo sintético, timeout e fallback. Configurar Calendar OAuth/credential e testar criação/alteração/cancelamento e reconciliação.
- Provisionar `SUPER_ADMIN` pelo procedimento operacional, testar enrollment/login TOTP e revogação; criar usuários clínicos com menor permissão necessária.
- Configurar alertas externos para API readiness, PostgreSQL, Redis, heartbeat, backlog/failed jobs e falhas dos providers. Health interno não substitui alerting.

## Ordem de implantação

1. Congelar commit e digests aprovados.
2. Verificar backup recente; pausar/drain worker se migration pedir janela.
3. Aplicar `prisma migrate deploy` uma vez no DB correto via secret manager. Não usar `migrate dev` ou editar migration histórica.
4. Iniciar API; confirmar `/health/live`, `/health/ready`, HTTPS, cookies e headers.
5. Iniciar worker compatível; confirmar heartbeat, consumidores e fila; verificar config fake ausente.
6. Iniciar Web; testar login e tenant. Validar Inbox, agenda, KB/AI settings, usage e Super Admin com perfis de teste.
7. Executar smoke sintético end-to-end: webhook assinado e duplicate ID, resposta, envio, HOLD/agendamento/cancelamento, notification, audit, Calendar e dashboard. Conferir isolamento com tenant sentinela.
8. Observar latência, falhas, filas, usage e alertas; habilitar tenants/canais gradualmente após aceite operacional.

## Rollback

- Reverter Web/API/Worker juntos para imagens compatíveis; drenar/pausar filas se o formato de job mudou.
- Não assumir reversão automática de migration. Priorizar migrations expand/contract. Para mudança destrutiva, restaurar backup em destino novo e planejar cutover com validação; não executar `DROP`/restore no cluster ativo sem plano aprovado.
- PostgreSQL é fonte de verdade. Após Redis recovery, deixar reconciliação reconstruir jobs; não reenviar mensagens manualmente sem conferir ledgers/idempotency keys.
- Após rollback, validar health, login, tenant, consulta, webhook dedupe, fila e audit; preservar evidências e registrar incidente.

## Registro operacional

Guardar commit/digests, horário UTC, migrations, duração, smoke, heartbeat, health, provider status, filas e decisão de rollback. Não incluir tokens, conteúdo clínico, telefone ou payload de mensagem.
