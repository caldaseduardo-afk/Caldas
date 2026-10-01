# Segurança e Privacidade

## 1. Princípio

Segurança não depende do prompt da IA.

## 2. Multi-tenancy

Toda operação de negócio deve validar tenant.

Padrão conceitual:

```text
resource.id = ?
AND resource.tenant_id = current_tenant
```

Nunca buscar recurso apenas pelo ID.

## 3. Defesa em profundidade

Aplicar:

1. tenant ativo na sessão;
2. autorização no service;
3. filtro obrigatório no repository;
4. testes de isolamento.

Avaliar PostgreSQL Row Level Security posteriormente como camada adicional.

## 4. Autenticação

- senha com hash moderno;
- MFA disponível;
- MFA obrigatório para SUPER_ADMIN;
- sessão segura;
- rate limiting;
- proteção contra brute force.

## 5. Autorização

Frontend não autoriza.

Backend deve validar:

- tenant;
- papel;
- permissão;
- unidade;
- relação contato/paciente quando aplicável.

## 6. Dados de paciente

Enviar à IA apenas o mínimo necessário.

Evitar dados sensíveis quando não forem necessários à tarefa.

## 7. Representantes

Não aceitar automaticamente "sou mãe", "sou marido" etc. como autorização completa.

Separar:

- relacionamento declarado;
- relacionamento verificado;
- nível de autorização.

## 8. Prompt injection

A IA deve operar com:

- tools fechadas;
- schemas validados;
- menor privilégio;
- output validation;
- context sanitization.

A IA nunca recebe:

- SQL;
- credenciais;
- chaves;
- secrets;
- dump de banco;
- dados irrelevantes de outros pacientes.

## 9. Tool Gateway

Cada tool deve validar novamente permissões.

Nunca assumir que, porque a IA chamou a tool, a ação está autorizada.

## 10. Webhooks

- verificar autenticidade quando provider suportar;
- idempotência;
- validação de schema;
- limite de payload;
- logs seguros.

## 11. Segredos

Usar variáveis de ambiente/secret manager.

Nunca commitar `.env`.

## 12. Logs

Não registrar:

- senha;
- token;
- secret;
- payload clínico desnecessário.

Mas manter audit trail apropriado.

## 13. Auditoria

Registrar:

- usuário;
- ação;
- recurso;
- valores relevantes;
- timestamp;
- tenant.

## 14. Segurança da agenda

Toda modificação deve registrar ator.

## 15. Testes obrigatórios

- tenant A não acessa tenant B;
- usuário sem permissão recebe 403;
- contato não autorizado não recebe dados;
- IA não consegue contornar Tool Gateway;
- resource ID de outro tenant não funciona;
- webhook duplicado não duplica mensagem.

## Autenticação inicial — TASK-003

A autenticação identifica uma pessoa global; não concede acesso a nenhuma clínica.
Sessão de tenant e permissões serão implementadas nas TASK-004/005.

- Senhas usam scrypt (N=131072, r=8, p=1), salt aleatório e comparação constante.
  Limite de duas derivações simultâneas por processo; senhas de 12 a 128 caracteres.
- Sessões são tokens opacos de 256 bits, com apenas SHA-256 persistido; duração
  absoluta de oito horas. Login renova o token apresentado; logout o remove do banco.
- Cookie HttpOnly/SameSite=Strict; produção usa Secure e prefixo __Host-, sem Domain.
  Produção exige HTTPS e AUTH_ORIGIN exata. AUTH_SECRET tem no mínimo 32 caracteres.
- Todas as rotas têm guard por padrão; exceções explícitas: health e login.
  POST exige Origin igual a AUTH_ORIGIN. Login aceita apenas JSON com limite de 8 KiB.
- Limites persistentes de login: 20 tentativas por IP e 5 por email a cada 15 minutos,
  inclusive tentativas bem-sucedidas. Incremento atômico; não confiar em X-Forwarded-For.
  Ao configurar reverse proxy, revisar explicitamente quais proxies são confiáveis.
- Eventos de identidade ficam em auth_events, sem senha/token/email. IP e chave de
  conta para limitação usam HMAC com AUTH_SECRET. Eventos não são alterados pela aplicação.
- MFA nesta tarefa é somente base: mfa_enabled ou mfa_required bloqueia login por
  senha e validação de sessões. Não há TOTP, enrollment ou códigos de recuperação.
  Não há provisionamento de SUPER_ADMIN; quando houver perfis, SUPER_ADMIN deverá
  exigir MFA completo antes de obter sessão. Não tratar esses campos como MFA concluído.
- Sem cadastro público; comando local de desenvolvimento cria identidade sem
  vínculos ou papéis. Erros de login não distinguem conta ausente, desativada ou MFA.
- Sessões expiradas e contadores antigos não são válidos mesmo antes de limpeza.
  Retenção/limpeza operacional deve preservar os eventos de auditoria; não há job
  automático nesta tarefa. Rotacionar AUTH_SECRET reinicia as chaves de limitação,
  mas não revoga sessões: revogação precisa remover os registros de sessão.

## Isolamento de tenant — TASK-004

O guard de tenant é obrigatório por padrão após autenticação. Exceções de
identidade/listagem/seleção são explícitas e não expõem recursos clínicos.
TenantContext é por requisição e usa apenas o snapshot autenticado de sessão.
Services e repositories revalidam; queries de Unit incluem tenant_id e condições
de vínculo/sessão/usuário ativos na própria consulta. Conhecer o ID de outro tenant
não basta. Role não permite bypass, inclusive SUPER_ADMIN.

UserTenant inativo ou Tenant com status diferente de ACTIVE bloqueia acesso.
Remover UserTenant revoga sessões selecionadas pela FK composta. Troca simultânea
de tenant faz o snapshot antigo falhar fechado. Os testes de integração exercitam
as duas direções A/B, concorrência, revogação entre validação e consulta, contexto
forjado, sessões independentes e ausência de endpoints de alteração de unidades.
RLS permanece uma camada futura; APIs funcionais novas deverão usar o mesmo padrão
obrigatório de contexto e repository, além das permissões da TASK-005.

## Autorização por permissão — TASK-005

PermissionGuard global executa após autenticação e contexto de tenant. Rotas sem
política explícita falham com 403. TenantOptional não isenta RBAC: exceções de
identidade/seleção são marcadas separadamente. A matriz fica em docs/tenancy.md e
no catálogo versionado de backend; não existe autorização decidida no frontend.

AuthorizationService revalida UserTenant do tenant ativo, role operacional
habilitado e permissões persistidas, além de usuário/sessão/tenant. Repositories
repetem as condições na consulta ao recurso, para não depender só de uma checagem
anterior. Role/permissões de headers, body ou query nunca autorizam. Sessões não
guardam cópias de permissões. Testes cobrem 403, permissões administrativas,
políticas cumulativas, revogação e papéis distintos por tenant.

SUPER_ADMIN continua sem capacidade privilegiada até existir MFA completo; ter
esse texto em um vínculo não habilita administração nem contorna isolamento.
MANAGER e roles desconhecidos também não autorizam. Os campos MFA existentes
continuam com comportamento de bloqueio da TASK-003. Seed RBAC é uma operação
administrativa explícita de aplicação de política versionada; não promove usuários
nem registra segredos. Concessões locais por tenancy:grant permanecem auditadas.

## Escritas de configuração — TASK-006

CRUD de unidades e alterações da clínica selecionada exigem settings.manage no
backend, além dos guards de identidade/tenant. Services e repositories repetem a
verificação. DTOs com campos extras são rejeitados para evitar atribuição de IDs,
tenant, papel ou campos geridos pelo servidor. POST/PATCH/DELETE exigem Origin;
CORS permite os métodos novos somente à origem configurada.

Escritas usam transação Serializable com revalidação de sessão, vínculo e permissão
no banco. Updates também incluem filtros de autorização na própria consulta.
Conflito de serialização retorna 409 para nova tentativa; falha de auditoria desfaz
a escrita. Eventos são inseridos na mesma transação e não possuem endpoints de
alteração. Não existe exclusão física de clínicas ou unidades.

Criação de clínica fica no provisionamento local de desenvolvimento, com usuário
existente e trilha explícita. settings.manage não autoriza criar clínicas externas.
Não foi acrescentado bypass para SUPER_ADMIN ou para clínica inativa.

## Contatos/canais — TASK-007

Rotas exigem contact.view/contact.edit, tenant ativo e sessão válida; serviços e
repositories revalidam. DTOs rejeitam IDs, tenant, contactId, verifiedAt e campos
extras. Normalização de telefone é sintática, não valida posse, não autentica
pessoa e não autoriza qualquer acesso a paciente. Identificador externo também
não concede autorização; não existe provider WhatsApp nesta entrega.

Transações Serializable, FK composta e índices únicos protegem criação, atualização
e troca de principal. Escritas de canal também atualizam o contato para serializar
mudanças concorrentes. Conflitos retornam 409 genérico sem divulgar nome, telefone,
tenant, ID conflitante ou detalhe SQL. Qualquer falha, inclusive de auditoria,
desfaz toda a operação. Um 409 concorrente exige recarregar e tentar novamente.
A auditoria persiste somente IDs/ação/campos alterados; não replica dados pessoais.
Erros de validação não ecoam o telefone fornecido.
