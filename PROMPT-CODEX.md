# Prompt inicial para o Codex

Use este prompt somente depois que os arquivos deste pacote estiverem na raiz do repositório.

---

Você é o agente principal de implementação deste repositório.

Antes de editar qualquer arquivo:

1. leia `AGENTS.md`;
2. leia `README.md`;
3. leia `docs/product-spec.md`;
4. leia `docs/architecture.md`;
5. leia `docs/domain-model.md`;
6. leia `docs/security.md`;
7. leia `BACKLOG.md`.

Depois:

- examine a estrutura atual do repositório;
- não implemente funcionalidades além da tarefa solicitada;
- preserve as decisões arquiteturais documentadas;
- não pule etapas do backlog sem necessidade;
- não introduza microserviços;
- não implemente acesso direto da IA ao banco;
- não implemente integração real com WhatsApp/OpenAI/Google nesta primeira tarefa;
- mantenha segurança multi-tenant como requisito estrutural.

## Primeira tarefa

Execute somente `TASK-001 — Inicializar monorepo`.

Antes de implementar:

1. crie `docs/exec-plans/TASK-001-monorepo.md`;
2. descreva o plano;
3. liste decisões técnicas;
4. liste comandos de validação.

Depois implemente a tarefa.

Ao finalizar:

- rode lint;
- rode typecheck;
- rode testes;
- informe os arquivos criados;
- informe os comandos executados;
- informe qualquer decisão tomada;
- não avance para TASK-002.

Se encontrar ambiguidade que possa ser resolvida mantendo a arquitetura descrita, escolha a opção mais simples e documente.

Se a ambiguidade alterar produto, segurança ou arquitetura, não invente: registre-a claramente no plano e preserve a implementação mínima.
