# Especificação Funcional

## 1. Produto

Plataforma SaaS multi-clínica para atendimento, relacionamento e agendamento de pacientes.

Canal inicial: WhatsApp.

O sistema combinará:

- IA;
- atendentes humanos;
- agenda;
- pacientes;
- automações;
- integrações;
- dashboards;
- auditoria.

## 2. Experiência

A conversa deve ser natural.

Evitar formulário disfarçado de chat.

A IA coleta dados progressivamente e apenas quando necessários.

## 3. Perfis

### SUPER_ADMIN
Administra a plataforma.

### CLINIC_ADMIN
Administra a clínica.

### AGENT
Atende pacientes e opera agenda.

### DOCTOR
Consulta agenda e dados permitidos.

### MANAGER
Previsto para relatórios e supervisão.

## 4. Contato x paciente

`CONTACT` representa quem está falando.

`PATIENT` representa quem receberá atendimento.

Um contato pode representar vários pacientes.

## 5. Representantes

Relacionamentos possíveis:

- SELF
- MOTHER
- FATHER
- SON_DAUGHTER
- SPOUSE
- LEGAL_GUARDIAN
- CAREGIVER
- SECRETARY
- OTHER

Status:

- DECLARED
- VERIFIED
- REVOKED

Autorização:

- FULL
- SCHEDULING_ONLY
- NO_ACCESS

## 6. Especialidade, serviço e profissional

Especialidade não é diretamente agendável.

O item agendável é `SERVICE`.

Um serviço possui:

- duração;
- buffers;
- preço opcional;
- regras próprias.

Profissionais são associados a serviços.

## 7. Agenda

A agenda suporta:

- disponibilidade recorrente;
- exceções;
- férias;
- bloqueios;
- disponibilidade extra;
- HOLD temporário;
- confirmação;
- remarcação;
- cancelamento;
- no-show;
- lista de espera.

## 8. Estados de consulta

- HOLD
- PENDING_CONFIRMATION
- CONFIRMED
- CHECKED_IN
- COMPLETED
- CANCELLED
- NO_SHOW
- RESCHEDULED

## 9. Confirmações e lembretes

A clínica define:

- antecedência;
- janela permitida de envio;
- dias permitidos;
- retries;
- ação após ausência de resposta.

Exemplo:

Consulta: 08:00  
Confirmação: 4h antes  
Janela: 08:00–20:00

Horário teórico: 04:00.

Se política = `PREVIOUS_ALLOWED_TIME`, enviar às 20:00 do dia anterior.

## 10. Conversas

Estados:

- AI_ACTIVE
- WAITING_PATIENT
- NEEDS_HUMAN
- HUMAN_ACTIVE
- RESOLVED
- CLOSED

Intenções:

- SCHEDULING
- RESCHEDULING
- CANCELLATION
- CONFIRMATION
- INFORMATION
- PAYMENT
- COMPLAINT
- CLINICAL_QUESTION
- OTHER

## 11. Human handoff

Motivos:

- USER_REQUESTED_HUMAN
- AI_LOW_CONFIDENCE
- PAYMENT_NEGOTIATION
- COMPLAINT
- CLINICAL_QUESTION
- AUTHORIZATION_PROBLEM
- SCHEDULING_CONFLICT
- SYSTEM_ERROR
- OTHER

Quando humano assumir, a IA para de responder.

Quando a conversa retornar à IA, gerar resumo interno antes de retomar.

## 12. Inbox

Interface inspirada em conceitos do WhatsApp Web:

- coluna de conversas;
- chat;
- painel de contexto.

Adicionar recursos operacionais:

- filtros;
- tags;
- fila de humano;
- SLA;
- responsável;
- paciente ativo;
- vínculo;
- autorização;
- consulta futura;
- notas internas.

## 13. WhatsApp

Usar integração oficial.

Não depender de automação de WhatsApp Web.

## 14. IA

A IA poderá:

- entender intenção;
- identificar paciente;
- responder FAQ permitido;
- consultar horários;
- criar HOLD;
- confirmar;
- remarcar;
- cancelar;
- encaminhar para humano.

A IA não poderá:

- acessar SQL;
- consultar banco livremente;
- ignorar autorização;
- obter segredos;
- visualizar outro tenant;
- decidir política de segurança.

## 15. Configuração da IA por clínica

A clínica define:

- nome;
- tom;
- apresentação;
- informações permitidas;
- regras de handoff;
- base de conhecimento;
- automações.

Configurações devem ter versão.

## 16. Automação

Suportar:

- confirmação;
- lembrete;
- retry;
- SLA humano;
- expiração de HOLD;
- sincronização de calendário;
- lista de espera;
- recuperação de atendimento.

## 17. Dashboard da clínica

Métricas iniciais:

- consultas;
- confirmações;
- cancelamentos;
- no-show;
- conversas;
- tempo de resposta;
- IA x humano;
- conversão em agendamento.

## 18. Super Admin

Deve visualizar:

- clínicas;
- planos;
- consumo;
- usuários;
- mensagens;
- IA;
- custos;
- integrações;
- falhas;
- jobs.

## 19. Critério de MVP

Uma clínica deve conseguir:

1. cadastrar estrutura;
2. cadastrar usuários;
3. cadastrar serviços e profissionais;
4. definir agenda;
5. conectar WhatsApp;
6. receber conversa;
7. atender por IA;
8. assumir por humano;
9. agendar;
10. remarcar;
11. cancelar;
12. confirmar;
13. enviar lembretes;
14. auditar ações;
15. operar sem vazamento entre tenants.
