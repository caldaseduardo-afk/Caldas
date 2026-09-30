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
