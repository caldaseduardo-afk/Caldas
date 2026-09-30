# Integrações

## 1. Princípio

Toda integração externa fica atrás de um provider.

## 2. WhatsApp

Canal inicial oficial.

Fluxo:

```text
WhatsApp
→ webhook
→ persistência
→ processamento
→ resposta
```

Requisitos:

- idempotência;
- status de entrega;
- anexos;
- textos;
- áudio;
- documentos;
- interações.

## 3. Calendário

Interface `CalendarProvider`.

Implementações futuras:

- Google Calendar
- Outlook
- calendário interno
- outros providers

O calendário externo não substitui o banco interno.

## 4. OpenAI

A integração de IA deve ficar isolada em provider/service.

Não espalhar chamadas de API em vários módulos.

Criar camada própria para:

- geração;
- tools;
- tracing quando aplicável;
- controle de custo;
- sanitização de contexto.

## 5. Storage

Arquivos devem usar storage compatível com S3.

Banco guarda metadados e referências.

## 6. Credenciais

`INTEGRATION.credentials_reference` deve apontar para segredo armazenado de forma segura.

Evitar credenciais em JSON de banco quando possível.

## 7. Retry

Integrações externas devem possuir retry com backoff quando adequado.

Não criar loop infinito.

## 8. Circuit breaker

Pode ser adicionado posteriormente se volume justificar.

## 9. Estados

Integrações devem possuir:

- ACTIVE
- DEGRADED
- ERROR
- DISABLED

## 10. Observabilidade

Registrar:

- falha;
- provider;
- tenant;
- operação;
- correlation id;
- duração;
- tentativa.

Nunca registrar secrets.
