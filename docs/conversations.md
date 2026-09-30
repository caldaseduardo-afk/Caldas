# Conversas, IA e Atendimento Humano

## 1. Interface

Layout em três áreas:

```text
Lista de conversas | Conversa | Contexto
```

## 2. Lista

Mostrar:

- nome;
- última mensagem;
- status;
- responsável;
- tempo de espera;
- prioridade;
- tags.

Filtros:

- Todas
- Não lidas
- IA
- Humano
- Precisa humano
- Aguardando paciente

## 3. Painel de contexto

Mostrar:

- contato;
- telefone/canal;
- paciente ativo;
- vínculo;
- autorização;
- pacientes relacionados;
- próxima consulta;
- notas;
- tags.

## 4. Estados

- AI_ACTIVE
- WAITING_PATIENT
- NEEDS_HUMAN
- HUMAN_ACTIVE
- RESOLVED
- CLOSED

## 5. Intenções

- SCHEDULING
- RESCHEDULING
- CANCELLATION
- CONFIRMATION
- INFORMATION
- PAYMENT
- COMPLAINT
- CLINICAL_QUESTION
- OTHER

## 6. Handoff

Quando humano assume:

- registrar usuário;
- alterar estado;
- suspender respostas automáticas da IA.

Quando humano devolve:

- produzir resumo;
- atualizar estado;
- reativar IA.

## 7. Lock

Somente um atendente deve poder responder como responsável por vez.

Supervisor autorizado pode transferir.

## 8. Nota interna

Nunca enviar nota interna ao canal externo.

## 9. Resumo

O resumo é dado auxiliar.

Não substituir histórico original.

## 10. Mensagens

Persistir antes do processamento.

Todo evento recebido deve ser idempotente por `provider_message_id`.

## 11. Áudio

Pode ser transcrito.

Manter metadados e referência ao original conforme política de retenção.

## 12. SLA humano

Configuração por clínica:

- primeiro alerta;
- segundo alerta;
- alerta externo.

Fila deve mostrar tempo aguardando.

## 13. Motivos de handoff

- USER_REQUESTED_HUMAN
- AI_LOW_CONFIDENCE
- PAYMENT_NEGOTIATION
- COMPLAINT
- CLINICAL_QUESTION
- AUTHORIZATION_PROBLEM
- SCHEDULING_CONFLICT
- SYSTEM_ERROR
- OTHER
