# Plano — Configurações de integrações por clínica

## Objetivo

Adicionar uma área administrativa por clínica para cadastrar e rotacionar a chave de API da IA e as credenciais necessárias ao WhatsApp, mantendo segredos fora do navegador, dos logs e das respostas da API.

## Escopo

- Persistir credenciais de integração por tenant cifradas em repouso com AES-256-GCM e uma chave mestra exclusiva `TENANT_CREDENTIALS_KEY` fornecida por ambiente/secret manager.
- Expor API tenant-scoped protegida por `settings.manage`, usando o tenant ativo da sessão e sem aceitar `tenantId` como autoridade.
- Adicionar interface de configurações com campos para OpenAI API key e WhatsApp access token, Phone Number ID e Business Account ID; GET retorna somente estado configurado e metadados não secretos.
- Fazer o `AIConfigResolver` resolver a chave do tenant atual sem fallback cruzado; manter modelo/base URL sob configuração operacional atual.
- Fazer o envio WhatsApp resolver o token cifrado da Integration. Preservar o comando de provisionamento existente e compatibilidade das referências antigas por variável de ambiente durante a transição.
- Auditar criação/rotação sem gravar valores secretos.
- Atualizar documentação operacional e `.env.example`.

## Fora de escopo

- Integração de billing, prova automática de titularidade de número, OAuth Meta, teste de conexão externo e onboarding Meta.
- Credenciais globais da aplicação Meta (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`), que permanecem operacionais e compartilhadas.
- Configuração completa de personalidade/prompt da IA, já coberta pelo módulo de versões existente.

## Arquivos afetados (estimativa)

- `packages/database/prisma/schema.prisma` e migration nova.
- Novo utilitário de cifragem compartilhado entre API e worker.
- `apps/api/src/configuration` (controller, service/repository/DTO e módulo) e módulo AI.
- `packages/database/src/messaging-delivery.ts` e configuração do worker WhatsApp.
- `apps/web/app` e `apps/web/components/settings` para navegação e formulário.
- `compose.yaml`, `.env.example`, `docs/integrations.md`, `docs/security.md`.
- Testes unitários e de integração API/DB/UI relevantes.

## Mudanças de banco

Adicionar credencial tenant-scoped para a chave OpenAI e campos cifrados para credencial de integração WhatsApp, com índices/FKs que preservem tenant e Integration. Não modificar migrations históricas. `Integration.settings` permanece nulo; não armazenar segredo em JSON.

## Decisões técnicas

- Cada clínica configura suas próprias chaves, conforme preferência confirmada pelo usuário.
- AES-256-GCM com nonce aleatório e AAD incluindo tenant, finalidade e integração. A chave mestra é independente de `PLATFORM_MFA_KEY`.
- O backend nunca devolve nem pré-preenche segredos. Atualizações substituem o segredo integralmente; formulário vazio significa manter, ação explícita limpa apenas se o domínio suportar com segurança.
- A IA resolve a credencial pelo tenant da sessão e falha fechada se ausente; nenhuma chave de outra clínica ou chave global é usada como fallback.
- Token WhatsApp é específico à Integration/tenant; app secret e verify token Meta continuam globais por aplicação.
- Auditoria contém ator, tenant, finalidade e resultado, nunca o valor ou prefixo do segredo.

## Riscos

- Rotação da chave mestra exige migração/re-encriptação operacional; sem a chave correta credenciais não podem ser recuperadas.
- Integrações WhatsApp já provisionadas por alias de ambiente precisam continuar operando durante a transição.
- O formulário não valida credenciais remotamente nesta entrega; configuração incorreta será detectada pelo provider no uso.
- Desenvolvimento local requer gerar `TENANT_CREDENTIALS_KEY` e disponibilizá-la igualmente à API e ao worker.

## Testes e validação

- Cifra/decifra, nonce/AAD, rejeição de ciphertext adulterado e ausência de exposição de segredos.
- CRUD de configurações com RBAC, tenant ativo, tentativa de tenantId adulterado e isolamento cross-tenant.
- OpenAI usa somente a chave do tenant requisitante e falha fechada sem credencial.
- Worker resolve token cifrado da Integration e mantém compatibilidade do provisionamento legado.
- UI lista estado configurado, envia segredos apenas ao backend e não os renderiza após salvar.
- Executar migration em banco de teste quando disponível, lint, typecheck, testes e build.

## Critérios de aceite

- Clinic Admin consegue cadastrar/rotacionar as chaves próprias na área Configurações.
- Respostas de API, logs, auditoria e UI não revelam segredo já armazenado.
- Tenant A não lê nem usa credenciais do Tenant B.
- OpenAI e WhatsApp usam credenciais do tenant correto no backend.
- RBAC e tenant ativo são verificados pelo backend.
- `settings.manage` continua sendo a fonte de autorização.

## Rollback

Reverter API/UI após desativar o formulário; migration aditiva mantém as credenciais cifradas sem quebrar o modelo anterior. Para rollback operacional, manter os aliases antigos de WhatsApp até confirmar migração. Não apagar ciphertext automaticamente. Remover credenciais por procedimento administrativo auditado.
