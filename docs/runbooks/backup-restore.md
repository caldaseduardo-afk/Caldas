# Runbook — backup e restore

Este repositório fornece PostgreSQL e Redis locais para desenvolvimento em
`compose.yaml`; isso não cria backup de produção. Em produção, configure backups
PostgreSQL criptografados, retenção fora do host primário e alertas de falha com o
provedor escolhido. Nunca grave credenciais, dumps ou URLs reais no repositório.

## Política inicial a confirmar com a operação

- Alvo inicial de recuperação (proposta, não SLA): RPO de até 24 horas usando
  backup diário e RTO de até 4 horas, sujeito ao tamanho do banco e a um restore
  ensaiado. Exija PITR/WAL arquivado se o negócio precisar de RPO menor.
- Retenção proposta: 7 diários e 4 semanais, criptografados, controlados pela
  plataforma de infraestrutura. Defina retenção legal antes de encurtar ou apagar.
- Redis é cache/fila operacional. PostgreSQL guarda a fonte de verdade; não dependa
  de restore de Redis para recuperar Appointment, HOLD, outbox ou ledger.

## Backup manual PostgreSQL

1. Confirme ambiente, cluster, database e janela; peça ao responsável pelo banco
   um usuário de leitura de backup e acesso a um local privado/criptografado.
2. Use um `pg_service.conf` e `.pgpass` temporários fora do repositório, com
   permissão `0600` e segredos injetados pelo secret manager. Não passe a senha em
   argumentos de processo nem a cole no terminal compartilhado.
3. Grave o dump custom fora do workspace e criptografe antes de copiar para storage
   remoto. O exemplo usa service name configurado localmente, sem credenciais:

   ```sh
   umask 077
   pg_dump --dbname=atendente-prod --format=custom --no-owner --file=/secure-backups/atendente-$(date -u +%Y%m%dT%H%M%SZ).dump
   pg_restore --list /secure-backups/atendente-YYYYMMDDTHHMMSSZ.dump >/dev/null
   ```

4. Registre timestamp UTC, cluster/database lógico, tamanho, checksum, versão do
   PostgreSQL e resultado da validação. Não registre a connection string.
5. Monitore a execução e a cópia criptografada; backup sem cópia externa e teste de
   restore não conta como backup recuperável.

O serviço gerenciado, PITR e criptografia em repouso devem ser preferidos quando
disponíveis. Proteja também os arquivos temporários e apague-os após confirmar a
cópia remota e o checksum.

## Restore seguro

1. Declare incidente/janela e escolha um cluster de recuperação isolado. Confirme
   em voz alta e por ticket que o host não é produção ativa.
2. Recupere chave de criptografia e dump pelo processo da plataforma; confira
   checksum, assinatura/identidade e `pg_restore --list` antes de executar.
3. Crie database vazio com versão compatível. Não use `--clean` contra destino
   desconhecido. Restaure em um destino novo:

   ```sh
   createdb atendente-restore
   pg_restore --dbname=atendente-restore --no-owner --exit-on-error /secure-backups/atendente-YYYYMMDDTHHMMSSZ.dump
   ```

4. Valide esquema e versão de migrations com `pnpm db:validate` e
   `pnpm --filter @atendente/database db:migrate` usando a URL isolada. Confira
   contagens/consistência sem exportar dados pessoais para relatórios. Teste login,
   tenant ativo, leitura de agenda e reconciliações com contas de teste.
5. Para promover a recuperação, troque a conexão usando secret manager, faça
   smoke test, observe erros/filas e mantenha o ambiente antigo isolado até a
   aprovação operacional. Não copie dados recuperados para produção sem verificar
   qual ponto no tempo será a fonte autorizada.

## Redis/job recovery

Redis não restaura dados de negócio. Após perda do Redis, suba uma instância vazia,
confirme PostgreSQL e worker, e deixe as rotinas de reconciliation reconstruírem
notificações, syncs de Calendar e SLA a partir dos ledgers persistidos. Não faça
replay manual da fila de envio sem conferir status e idempotency key. Monitore jobs
failed/delayed e os ledgers antes de habilitar envio externo. Confirme que HOLDs
expirados são varridos pelo worker.

## Ensaios e retenção

Execute restore completo ao menos trimestralmente e após mudança significativa de
schema/infra; registre duração, RPO observado, RTO observado, migrações e falhas.
Defina retenção de mensagens, auditoria, uso de IA, logs e jobs falhos antes de
qualquer limpeza automática, considerando obrigações legais e dados clínicos.
