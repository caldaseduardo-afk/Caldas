# Agenda e Agendamentos

## 1. Regra principal

O backend calcula disponibilidade.

A IA apenas solicita opções.

## 2. Geração de slots

Para buscar horários:

1. identificar serviço;
2. determinar duração;
3. localizar profissionais aptos;
4. carregar disponibilidade recorrente;
5. aplicar exceções;
6. excluir conflitos;
7. considerar buffers;
8. considerar HOLDs;
9. aplicar unidade;
10. retornar opções.

## 3. HOLD

Ao escolher um horário:

1. criar HOLD;
2. bloquear slot temporariamente;
3. solicitar confirmação;
4. converter em consulta após confirmação;
5. expirar automaticamente se não confirmado.

Tempo padrão sugerido: 5 minutos.

Deve ser configurável.

## 4. Concorrência

Dois pacientes não podem obter o mesmo slot.

A criação do HOLD deve possuir proteção transacional/lock apropriado.

## 5. Confirmações

Regra:

```text
target = appointment_start - offset
```

Depois validar:

- janela horária;
- dias permitidos;
- tempo mínimo restante;
- política para fora da janela.

Políticas:

- PREVIOUS_ALLOWED_TIME
- NEXT_ALLOWED_TIME
- SKIP

## 6. Exemplo

Consulta: terça 08:00  
Offset: 4h  
Target: terça 04:00  
Janela: 08:00–20:00  
Policy: PREVIOUS_ALLOWED_TIME

Resultado: segunda 20:00.

## 7. Retry

Retries respeitam a mesma janela.

Nunca enviar automaticamente às 23h apenas porque o intervalo configurado foi 4 horas.

## 8. Confirmação x lembrete

`CONFIRMATION`: espera resposta.

`REMINDER`: informativo.

## 9. Cancelamento

Políticas de cancelamento pertencem à clínica.

A IA nunca inventa exceção.

Se ação estiver fora da regra:

- bloquear;
- explicar de forma administrativa;
- oferecer handoff quando configurado.

## 10. Remarcação

Preservar relação entre consulta anterior e nova.

Não perder histórico.

## 11. Calendar sync

Criar/alterar consulta no PostgreSQL primeiro.

Sincronizar com calendário externo posteriormente.

## 12. Testes obrigatórios

- sobreposição;
- buffers;
- exceções;
- HOLD concorrente;
- expiração;
- timezone;
- confirmação fora da janela;
- retry fora da janela;
- remarcação;
- cancelamento;
- provider indisponível.
