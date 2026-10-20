# Organização da interface web

## Objetivo
Reorganizar a experiência da inbox e a navegação da aplicação com base na referência visual fornecida, preservando as operações e permissões existentes.

## Escopo
- Atualizar a barra superior compartilhada da inbox para incluir identidade, navegação para áreas existentes, seletor de clínica e sessão.
- Refinar a hierarquia visual da lista, conversa e contexto usando layout responsivo.
- Tornar a página inicial um ponto de entrada funcional e organizado, sem links administrativos dispersos.
- Adicionar na tela de integrações um indicador visual local para simular conexão WhatsApp, sem chamadas externas.
- Não criar funcionalidades inexistentes de agenda, contatos, relatórios ou automações.

## Arquivos afetados
- `apps/web/components/inbox/inbox.tsx`
- `apps/web/components/inbox/conversation-list.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`
- `docs/exec-plans/frontend-organization.md`

## Mudanças de banco
Nenhuma.

## Riscos
- A barra de navegação pode sugerir módulos não implementados; por isso, usar apenas destinos existentes.
- Mudanças CSS podem afetar telas menores; validar breakpoints existentes e testes da inbox.
- O backend continua fonte de verdade para tenant e permissões; a interface não deve conceder acesso.

## Testes
- Testes unitários da inbox e navegação.
- `pnpm --filter @atendente/web lint`
- `pnpm --filter @atendente/web typecheck`
- `pnpm --filter @atendente/web test`
- `pnpm --filter @atendente/web build`

## Critérios de aceite
- O usuário pode navegar entre conversas, dashboard e configurações existentes pelo topo.
- Inbox continua com lista, chat, contexto, handoff e comportamento responsivo.
- Troca de clínica e logout continuam funcionais.
- Nenhuma autorização é decidida no frontend e nenhum endpoint inexistente é apresentado como disponível.

## Rollback
Reverter somente os arquivos da interface e este plano; sem alterações persistentes ou migration.
