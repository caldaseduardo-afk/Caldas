# TASK-007 — Contatos e canais

## Objetivo e escopo

Criar Contact e ContactChannel com vínculo obrigatório ao tenant, canais PHONE e
WHATSAPP, normalização e busca por telefone, atualização e canal principal.
Preservar autenticação, RBAC e isolamento existentes. Não implementar Patient,
ContactPatient, representantes, agenda, verificação de identidade ou provider real.

## Decisões técnicas

- Contact: UUID, tenantId, displayName, status ACTIVE/INACTIVE, timestamps.
  ContactChannel: UUID, tenantId, contactId, type PHONE/WHATSAPP, address normalizado,
  providerExternalId opcional, primary, verifiedAt nulo e timestamps.
- Novas permissões contact.view/contact.edit, independentes de patient.*:
  CLINIC_ADMIN e AGENT recebem ambas; DOCTOR e perfis reservados não recebem acesso
  a contatos. Não confundir leitura futura de pacientes autorizados com diretório.
- Telefones nacionais de 10/11 dígitos usam Brasil (+55) como padrão explícito.
  Aceitar formatação com espaços, parênteses, ponto/hífen e DDI 55 explícito.
  Os três exemplos do usuário normalizam para +5561999999999. Validar estrutura
  brasileira (DDD, fixo/móvel) sem consultar operadora. Internacionais exigem + e
  8–15 dígitos; validação sintática, sem afirmar que número existe ou é alcançável.
  Rejeitar letras/ramais, prefixo de operadora, números locais sem DDD e entradas
  ambíguas. Armazenar só a forma canônica; mesma função em criação, PATCH e busca.
- Unicidade de canal por (tenantId,type,address): PHONE e WHATSAPP são canais
  distintos, podendo usar o mesmo telefone. Não fundir contatos automaticamente.
  Busca retorna lista de contatos distintos do tenant para o telefone, pois tipos
  diferentes podem pertencer a contatos diferentes. Mesmo número em outro tenant
  não causa conflito nem é revelado. Inativar contato não libera seus canais.
- providerExternalId é metadado opaco, sem autenticar/validar posse. Unicidade por
  (tenantId,type,providerExternalId) quando não nulo. Namespace inicial é o tipo;
  múltiplos providers por tipo exigirão revisão na tarefa de integração.
- FK composta do canal para Contact garante tenant igual ao do contato. Índice
  parcial único por (tenantId,contactId) WHERE primary garante no máximo um principal.
  Aplicação mantém exatamente um quando há canais: primeiro é principal por padrão,
  promover outro troca atomicamente. Não permitir desmarcar o principal sem escolher
  substituto. Sem exclusão de canais nesta tarefa. Contato sem canais é permitido.
- DTOs rejeitam campos extras, tenantId/contactId/IDs/verifiedAt controlados pelo
  servidor, tipos inválidos, PATCH vazio e múltiplos principais no cadastro.
  Alterar endereço limpa verifiedAt e ID externo antigo salvo substituição explícita.
- Endpoints: POST/GET /contacts, GET/PATCH /contacts/:id, POST
  /contacts/:id/channels e PATCH /contacts/:id/channels/:channelId. GET /contacts
  aceita somente filtro phone opcional; IDs via ParseUUIDPipe. Leitura retorna canais.
- Controllers/services/repositories separados. Guard, service e repository validam
  permissões; queries filtram tenant e autorização. Escritas Serializable com
  revalidação na transação, constraints e 409 genérico em duplicidade/conflito.
- Auditoria mínima na infraestrutura AuthEvent, atômica com a escrita: ação, ator,
  tenant, ID e nomes dos campos alterados; não duplicar telefones/nomes/IDs externos
  nos logs de auditoria. Nenhuma chamada externa ou acesso de IA ao banco.

## Arquivos afetados e banco

Schema/migration Prisma; catálogo RBAC e testes da matriz; apps/api/src/contacts;
app.module; testes unitários/integração; README e docs de domínio/tenancy/segurança.
Migration aditiva: enums, contacts, contact_channels, FKs, unique e índices,
CHECK de endereço canônico e índice parcial de principal. Revisar SQL antes de
aplicar; não alterar dados existentes ou resetar banco.

## Riscos e testes de aceite

- Mesmos três formatos encontram o mesmo contato; busca sem duplicar resultado.
- Duplicidade no tenant retorna 409 em create/PATCH e concorrência; B reutiliza número.
- A não lê/atualiza/descobre contato ou canal de B por ID, filtro ou payload.
- Troca de principal e rollback em conflito preservam exatamente um principal.
- FK impede associar canal ao contato de outro tenant mesmo por SQL administrativo.
- RBAC 401/403, CSRF, DTOs, metadados externos, revogação e chamada direta ao repository.
- Regressão auth/tenancy/RBAC/clínicas e seed de permissões idempotente.

## Comandos

pnpm db:generate; pnpm db:validate; pnpm lint; pnpm typecheck; pnpm test;
pnpm db:test; pnpm build; pnpm format:check; git diff --check.
Após testes descartáveis: pnpm db:migrate; pnpm db:seed:rbac; Prisma migrate diff;
smoke da API compilada. Sem avanço para TASK-008.

## Rollback

Desabilitar rotas novas se necessário; preservar eventos/dados e migrations
aplicadas. Reversão de schema somente com backup e migration compensatória revisada.
Nenhuma exclusão de volumes ou regressão de isolamento/autorização.

## Resultado

Em implementação.
