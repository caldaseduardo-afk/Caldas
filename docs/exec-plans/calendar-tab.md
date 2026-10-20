# Plano — Aba Agenda

## Objetivo
Disponibilizar uma agenda semanal para consulta, reaproveitando a API de Appointment e suas regras de tenant/RBAC.

## Escopo
- Criar endpoint GET `/appointments/calendar` com resumo mínimo (nome do paciente, serviço, profissional, unidade, período, status), protegido pelas permissões de leitura existentes.
- Criar página `/agenda` com navegação semanal, timezone da clínica, filtro por unidade e estados vazios/erro/loading.
- Adicionar “Agenda” à navegação superior e ao ponto de entrada.
- Manter a interface somente para consulta; não duplicar criação, cancelamento ou remarcação do backend.

## Arquivos afetados
- `apps/api/src/appointments/appointments.controller.ts`
- `apps/api/src/appointments/appointments.service.ts`
- `apps/api/src/appointments/appointment.repository.ts`
- `apps/api/integration/appointments.test.ts`
- `apps/web/lib/proxy.ts`
- `apps/web/app/agenda/page.tsx`
- `apps/web/components/calendar/calendar.tsx`
- `apps/web/components/inbox/top-navigation.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/test/calendar.test.tsx`

## Mudanças de banco
Nenhuma.

## Riscos
- Datas da semana precisam respeitar o timezone selecionado, inclusive transições DST; o intervalo HTTP será convertido de meia-noite local para UTC.
- A resposta do calendário contém nome do paciente; manter apenas campos necessários e exigir as mesmas permissões `appointment.view` + `patient.view`.
- A API limita consultas a 31 dias; a tela requisita somente uma semana.

## Testes
- Integração API para resposta resumida e isolamento cross-tenant, incluindo ausência de campos internos.
- Testes de utilitários de semana/timezone e renderização da página.
- `pnpm --filter @atendente/api lint`, typecheck e testes relacionados (`pnpm db:test`).
- `pnpm --filter @atendente/web lint`, typecheck, testes e build.

## Critérios de aceite
- A aba Agenda é navegável no menu.
- Exibe consultas da semana selecionada, separadas por dia, com horários na timezone da clínica.
- Filtro por unidade e navegação anterior/próxima/semana atual funcionam.
- A interface mostra somente campos do resumo; autorização e tenant continuam no backend.
- Não implementa criação, remarcação ou cancelamento nesta etapa.

## Rollback
Remover página, rota de leitura e entrada de menu; não há alteração de schema nem efeitos persistentes.
