# Multi-Tenancy, Usuários e Permissões

## 1. Tenant

Cada clínica é um tenant.

Uma clínica pode possuir várias unidades.

## 2. Usuários

Um usuário pode pertencer a mais de um tenant.

Usar relação `USER_TENANT`.

## 3. Perfis

- SUPER_ADMIN
- CLINIC_ADMIN
- AGENT
- DOCTOR
- MANAGER futuro

## 4. Permissões

Permissões iniciais:

```text
conversation.view
conversation.reply
conversation.assign
conversation.transfer
conversation.close

patient.view
patient.edit

appointment.view
appointment.create
appointment.reschedule
appointment.cancel

provider.manage
service.manage

user.manage
settings.manage
analytics.view
billing.view
```

## 5. Unidades

Usuários podem ter escopo por unidade.

## 6. SUPER_ADMIN

O SUPER_ADMIN opera fora do contexto normal de clínica, mas toda operação sobre dados de tenant deve ser explicitamente selecionada e auditada.

Evitar mecanismos ocultos de "bypass tenant".

## 7. Troca de tenant

Quando usuário pertence a múltiplas clínicas:

1. autentica;
2. recebe lista de tenants;
3. seleciona tenant;
4. tenant ativo entra na sessão/contexto;
5. toda operação usa esse tenant.

## 8. Testes

Criar suíte explícita de segurança multi-tenant.

Ela deve ser executada continuamente.
