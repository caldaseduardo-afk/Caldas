# Atendente IA — Plataforma SaaS para Clínicas

Plataforma multi-clínica de atendimento por WhatsApp, agendamento e automação com IA e atendimento humano.

## Objetivo

Permitir que clínicas:

- recebam pacientes pelo WhatsApp;
- atendam com IA e humanos no mesmo histórico;
- cadastrem pacientes, contatos e representantes;
- consultem disponibilidade;
- agendem, remarquem, cancelem e confirmem consultas;
- configurem lembretes e confirmações;
- integrem agendas externas;
- mantenham auditoria completa;
- operem como SaaS multi-tenant.

## Princípio central

> A IA interpreta. O backend autoriza e executa.

A IA nunca deve acessar diretamente banco de dados, credenciais ou integrações sensíveis.

## Estrutura da documentação

- `AGENTS.md` — regras permanentes para o Codex.
- `docs/product-spec.md` — especificação funcional.
- `docs/architecture.md` — arquitetura técnica.
- `docs/domain-model.md` — entidades e relacionamentos.
- `docs/scheduling.md` — agenda, disponibilidade e notificações.
- `docs/conversations.md` — inbox, IA e atendimento humano.
- `docs/security.md` — segurança, autorização e privacidade.
- `docs/integrations.md` — WhatsApp, calendário e IA.
- `docs/tenancy.md` — multi-tenancy e permissões.
- `docs/roadmap.md` — fases de desenvolvimento.
- `BACKLOG.md` — tarefas sequenciais.
- `PROMPT-CODEX.md` — prompt inicial para o Codex.
- `docs/exec-plans/` — planos de execução criados durante tarefas maiores.

## Arquitetura inicial

- Frontend: Next.js + React + TypeScript
- Backend: NestJS + TypeScript
- Banco: PostgreSQL
- ORM: Prisma
- Cache/locks/jobs: Redis
- Jobs: BullMQ
- Tempo real: WebSocket
- Storage: S3 compatível
- Monorepo: pnpm + Turborepo
- Deploy: Docker

## Ordem recomendada

Não iniciar pela IA.

A ordem inicial deve ser:

1. Estrutura do monorepo
2. Banco e migrations
3. Autenticação
4. Multi-tenancy
5. Usuários e permissões
6. Clínicas e unidades
7. Pacientes e contatos
8. Profissionais, especialidades e serviços
9. Agenda
10. Conversas
11. WhatsApp
12. IA
13. Automações
14. Dashboards

## Regra para alterações

Toda mudança que alterar comportamento de negócio, segurança, arquitetura ou modelo de dados deve atualizar a documentação correspondente.
