# Atendente IA para Clínica — MVP release notes

Versão/tag: não criada. Os pacotes permanecem `0.0.0` e não há convenção de release versionado no repositório. Avaliação local em 2026-10-18.

O MVP entrega aplicação web, API modular e worker para atendimento por tenant. Inclui autenticação, RBAC, clínicas/unidades, contatos, pacientes e representantes, catálogo de especialidades/serviços/profissionais, disponibilidade e consultas com HOLD, notificações, Inbox/realtime, handoff/SLA, WhatsApp, AI provider, Tool Gateway, Conversation Engine e fluxos de agendamento/cancelamento/remarcação, Base de Conhecimento, configuração de IA versionada, Google Calendar, auditoria, dashboard, Super Admin com TOTP e medição de plano/uso.

PostgreSQL permanece fonte de verdade de negócio; Redis/BullMQ coordena rate limiting e tarefas assíncronas. A API autoriza operações e limita tools; integrações externas ficam atrás de providers para permitir testes controlados.

Lint, typecheck, unit, integração PostgreSQL/Redis descartáveis, browser mock E2E, build e dependency audit passaram nesta execução. O candidato está **MVP RC BLOCKED** até validar o fluxo conectado completo e as pendências operacionais documentadas em `MVP-KNOWN-ISSUES.md`. Estas notas não certificam prontidão para produção.
