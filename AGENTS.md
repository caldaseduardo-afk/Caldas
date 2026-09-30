# AGENTS.md

## Papel deste arquivo

Este arquivo é o índice operacional do repositório.

Não trate este arquivo como documentação completa. Antes de modificar código, leia os documentos relevantes em `docs/`.

## Fonte de verdade

Leia conforme a tarefa:

- Produto e regras funcionais: `docs/product-spec.md`
- Arquitetura: `docs/architecture.md`
- Modelo de domínio: `docs/domain-model.md`
- Agenda: `docs/scheduling.md`
- Conversas e handoff: `docs/conversations.md`
- Segurança: `docs/security.md`
- Integrações: `docs/integrations.md`
- Multi-tenancy: `docs/tenancy.md`
- Roadmap: `docs/roadmap.md`
- Backlog: `BACKLOG.md`

## Princípios obrigatórios

1. A IA interpreta; o backend autoriza e executa.
2. Nunca dê ao modelo acesso direto ao banco.
3. Nunca confie no prompt como mecanismo principal de segurança.
4. Toda operação de negócio deve validar `tenant_id`.
5. Nunca permita leitura ou alteração cruzada entre tenants.
6. Toda ação sensível deve ser auditável.
7. Não armazenar senhas, tokens ou segredos em código.
8. Não enviar dados desnecessários de pacientes ao modelo de IA.
9. Toda integração externa deve ficar atrás de uma interface/provider.
10. PostgreSQL é a fonte principal de verdade da agenda.
11. O WhatsApp é canal de comunicação, não banco de dados.
12. Google Calendar ou outro calendário externo não é fonte primária de verdade.
13. Persistir mensagens antes de processá-las com IA.
14. Webhooks devem ser idempotentes.
15. Não duplicar lógica de autorização no frontend.
16. O frontend nunca decide autorização.
17. Não implementar microserviços no MVP.
18. Evite abstrações prematuras.
19. Prefira módulos claros e simples.
20. Não alterar arquivos fora do escopo da tarefa sem necessidade.

## Stack esperada

- TypeScript
- Next.js
- NestJS
- PostgreSQL
- Prisma
- Redis
- BullMQ
- WebSocket
- pnpm
- Turborepo
- Docker

Não substituir tecnologias centrais sem justificar e atualizar `docs/architecture.md`.

## Estrutura pretendida

```text
/apps
  /web
  /api
  /worker

/packages
  /database
  /domain
  /types
  /ui
  /config

/docs
  /exec-plans
```

## Qualidade

Para cada tarefa:

1. Entenda o escopo.
2. Leia os documentos relevantes.
3. Verifique código existente antes de criar duplicações.
4. Implemente a menor mudança completa.
5. Adicione ou atualize testes.
6. Rode lint.
7. Rode typecheck.
8. Rode testes relacionados.
9. Revise migrations antes de aplicar.
10. Atualize documentação quando necessário.

## Testes mínimos

Devem existir testes para:

- isolamento entre tenants;
- autorização;
- conflitos de agenda;
- idempotência de webhooks;
- expiração de HOLD;
- transições de estado;
- regras de confirmação;
- handoff IA → humano;
- bloqueio de duas pessoas atendendo a mesma conversa.

## Alterações no domínio

Antes de mudar entidades, estados ou regras centrais:

- leia `docs/domain-model.md`;
- leia o documento funcional relacionado;
- documente a decisão.

## Segurança

Leia obrigatoriamente `docs/security.md` antes de qualquer tarefa envolvendo:

- autenticação;
- autorização;
- pacientes;
- representantes;
- IA;
- webhooks;
- integrações;
- dados clínicos;
- credenciais.

## IA

O agente de atendimento deve usar tools limitadas.

Não exponha ao modelo:

- SQL;
- Prisma client;
- tokens;
- segredos;
- dados de outros tenants;
- dados de pacientes não necessários à ação.

## Tarefas grandes

Para uma tarefa que altere vários módulos, crie primeiro um plano em:

`docs/exec-plans/<task-id>-<nome>.md`

O plano deve conter:

- objetivo;
- escopo;
- arquivos afetados;
- mudanças de banco;
- riscos;
- testes;
- critérios de aceite;
- rollback quando aplicável.

## Git

Prefira commits pequenos e coerentes.

Não misture refatoração ampla com implementação funcional sem necessidade.

## Documentação

Se o código e a documentação divergirem, não escolha silenciosamente um lado.

Identifique a divergência e corrija a documentação ou a implementação dentro do escopo da tarefa.
