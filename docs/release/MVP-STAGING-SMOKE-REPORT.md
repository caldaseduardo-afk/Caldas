# Relatório de acceptance local e smoke de staging

- Timestamp: 2026-10-18 20:33:36 -03.
- Base: `main` em `05842f817f3edc632d33a9b3cd3df46b9a2a14c3`, com working tree local alterada e ainda não commitada.
- Ambiente integrado: execução local com PostgreSQL 17 e Redis 7.4 descartáveis; app Nest/API real; FakeAIProvider; serviços e Tool Gateway reais; worker de notificação real.
- Staging: **não provisionado**. Este relatório não classifica localhost como staging.
- Dados: somente fixtures sintéticas; sem dados de pacientes ou credenciais de providers reais.

## Acceptance integrado local

Comando: `pnpm db:test`  
Resultado: **PASS**, 307 testes, 0 falhas. Migrations desde zero, reaplicação, seed e integração passaram. A suíte incluiu `acceptance conectado: webhook, engine, scheduling, workers, handoff e tenant isolation` (23 verificações aninhadas).

O acceptance passou pelo webhook assinado na API real, persistência de Contact/Conversation/Message, Conversation Engine com FakeAIProvider, Tool Gateway e consulta de disponibilidade, HOLD, confirmação/Appointment, audit, notification scheduling e worker real. Validou reprocessamento idempotente, handoff para agente autorizado, health/readiness e tentativa cross-tenant com ID conhecido recusada sem leitura/mutação/audit indevido. Sentinelas de segredo não apareceram nos logs capturados.

IDs sintéticos de correlação registrados pelo teste:

```text
fb14f1c0-6af8-4ac1-8e56-dfe7036c789e
5716b29f-cff9-45c0-a923-b3844fb58b08
ac17932b-1894-4926-9c17-7901b5b2da80
b13f151b-5e6b-4237-8ef2-22dc76940ce5
```

## Checks de staging

Todos os checks abaixo estão **NOT RUN / BLOCKING**, pois não há ambiente staging implantado e acessível nesta sessão:

| Check                                    | Resultado | Pré-requisito para executar                                                                     |
| ---------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| Web HTTPS                                | NOT RUN   | Web implantada, domínio e certificado aprovados.                                                |
| API health + PostgreSQL + Redis          | NOT RUN   | API staging e dependências configuradas.                                                        |
| Worker heartbeat + failed jobs           | NOT RUN   | Worker staging acompanhado por operador.                                                        |
| Autenticação e sessão                    | NOT RUN   | Usuários/contas sintéticos e URL staging.                                                       |
| Isolamento básico Tenant A/B             | NOT RUN   | Dados sintéticos em staging; chamada autenticada cruzada esperada como 404/403 sem side effect. |
| Conversation/Message                     | NOT RUN   | Provider de mensageria de teste habilitado e callback HTTPS.                                    |
| Appointment mínimo + audit               | NOT RUN   | Catálogo, disponibilidade e usuário sintéticos carregados.                                      |
| Notifications/outbox                     | NOT RUN   | Worker e provider de saída de teste; validar idempotência sem destinatário real.                |
| Correlação e redaction em logs coletados | NOT RUN   | Coletor/retention de staging e acesso operacional sem payload pessoal.                          |
| Rollback                                 | NOT RUN   | Plataforma/runtime escolhido e versão anterior identificável.                                   |

## CI e publicação

O workflow versionado localmente define install congelado, Gitleaks, audit, Prisma validate, lint, typecheck, testes, migration/integration test, browser E2E e build. Não foi executado em CI remoto porque não houve push/publicação. Branch protection/required checks também não foram modificados nem comprovados.

## Limites

O resultado local prova a integração entre os módulos testados com infraestrutura descartável e provider de IA fake. Não prova envio/recebimento com WhatsApp real, comportamento do provedor OpenAI, entrega HTTPS, frontend Web conectado ao backend, runtime de produção, métricas/alertas, backup externo ou disponibilidade operacional.
