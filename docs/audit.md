# Auditoria de negócio — TASK-030

## Modelo e compatibilidade

`AuthEvent`, mapeado para `auth_events`, é a tabela existente do AuditLog. Não há
segunda tabela nem cópia de histórico. `type` é a action tipada em AuthEventType;
`userId` é actor_user_id. Campos novos: isBusiness, actorType, actorReferenceId,
source, resourceType, previousValues, newValues, metadata e correlationId. id,
resourceId, tenantId e createdAt permanecem; não existe updatedAt.

Novas ações de negócio exigem tenant e recurso no helper e no CHECK do PostgreSQL.
Identidade global (criação de identidade/login/logout) continua sem tenant quando
nenhuma clínica existe/foi selecionada. Esses eventos não são expostos por /audit.
Eventos técnicos legados permanecem preservados com isBusiness=false; sucesso de
sync, retries, mensagens e execução de tools não são ações de negócio na consulta.
CalendarSyncAttempt, NotificationAttempt e ToolExecution continuam seus ledgers.

A migration aditiva mantém IDs, timestamps, payloads e relações antigos. Marca como
negócio apenas ações conhecidas com tenant e recurso. Histórico sem proveniência
mantém source SYSTEM, pois não é possível reconstruir uma origem não registrada.
O endpoint sanitiza também metadata histórica. Não se promete autoria retroativa
mais precisa do que a informação disponível antes desta migration.

## Escrita, ator e correlação

recordAudit/recordAuditMany são o único ponto de inserção da aplicação e recebem
explicitamente o transaction client da mutação. Não há repository/service/API de
update/delete. FKs de tenant e usuário são Restrict; inativação não remove histórico.
Acesso administrativo ao banco continua possível para migrations/manutenção.

USER usa a identidade autenticada. AuditContextInterceptor apenas fornece contexto
por requisição (não cria eventos automáticos): WEB para chamadas com Origin, API
nas demais, e UUID de correlação gerado no servidor. Tool Gateway substitui o
contexto confiável por AI/AI_ENGINE quando apropriado e preserva a correlação do
turno. Não recebe ator/tenant pelo DTO. Engine usa seu grant validado. Worker registra
AUTOMATION/WORKER; ingresso WhatsApp registra INTEGRATION/WHATSAPP. Não há usuário fake.
Tenant sempre representa o recurso. SUPER_ADMIN segue o bloqueio atual, sem bypass.

Snapshots usam before/after explícitos ou from/to de status; handoff inclui os
responsáveis anterior/novo e reason mínimo. Nunca há snapshot automático da entidade.
Sanitização recursiva remove chaves de credenciais, sessão, headers, prompts, conteúdo,
documentos e contatos pessoais; preserva authorizationLevel por ser dado de segurança,
não header de autenticação. Limites de profundidade, arrays, campos e strings evitam
payloads sem limite. Dados em prosa exigem minimização pelo chamador; o sanitizer não
é um classificador completo de dados pessoais. React escapa JSON na tela.

## Matriz de cobertura

O catálogo executável completo fica em AUDIT_ACTION_RESOURCES, packages/database/src/audit.ts.

| Módulo                 | Ações                                                                                     | Ator esperado                   | Recurso                              |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| Clínica/unidades       | TENANT_CREATED/UPDATED/DEACTIVATED, UNIT_CREATED/UPDATED/DEACTIVATED                      | USER; SYSTEM no provisionamento | TENANT/UNIT                          |
| Vínculo administrativo | TENANT_MEMBERSHIP_GRANTED                                                                 | SYSTEM no comando local         | USER                                 |
| Contatos/canais        | CONTACT_CREATED/UPDATED, CONTACT_CHANNEL_CREATED/UPDATED                                  | USER/INTEGRATION                | CONTACT/CONTACT_CHANNEL              |
| Pacientes              | PATIENT_CREATED/UPDATED, CONTACT_PATIENT_CREATED/UPDATED/REVOKED                          | USER                            | PATIENT/CONTACT_PATIENT              |
| Catálogo               | SPECIALTY_CREATED/UPDATED, SERVICE_CREATED/UPDATED                                        | USER                            | SPECIALTY/SERVICE                    |
| Profissionais          | PROVIDER_CREATED/UPDATED, PROVIDER_SERVICE_CREATED/UPDATED, PROVIDER_UNIT_CREATED/UPDATED | USER                            | PROVIDER (inclui IDs de vínculos)    |
| Disponibilidade        | AVAILABILITY_RULE_CREATED/UPDATED, SCHEDULE_EXCEPTION_CREATED/UPDATED                     | USER                            | AVAILABILITY_RULE/SCHEDULE_EXCEPTION |
| HOLD                   | HOLD_CREATED/RELEASED/EXPIRED                                                             | USER/AI/AUTOMATION              | APPOINTMENT_HOLD                     |
| Consultas              | APPOINTMENT_CREATED/CONFIRMED/CANCELLED/RESCHEDULED/CHECKED_IN/COMPLETED/NO_SHOW          | USER/AI                         | APPOINTMENT                          |
| Conversas              | CONVERSATION_CREATED/UPDATED/STATUS_CHANGED/CLAIMED/TRANSFERRED/RETURNED_TO_AI/RESOLVED   | USER/AI/INTEGRATION             | CONVERSATION                         |
| Handoff                | HUMAN_HANDOFF_REQUESTED, CONVERSATION_ENGINE_HANDOFF                                      | USER/AI/AUTOMATION              | CONVERSATION                         |
| Regras                 | NOTIFICATION_RULE_CREATED/UPDATED, HUMAN_SLA_RULE_CREATED/UPDATED                         | USER                            | NOTIFICATION_RULE/HUMAN_SLA_RULE     |
| Conhecimento           | KNOWLEDGE_ARTICLE_CREATED/UPDATED/PUBLISHED/INACTIVATED                                   | USER                            | KNOWLEDGE_ARTICLE                    |
| IA                     | AI_CONFIG_VERSION_CREATED/UPDATED, AI_CONFIG_PUBLISHED/RESTORED                           | USER                            | AI_CONFIGURATION                     |
| Integrações            | INTEGRATION_CONFIGURED, CALENDAR_INTEGRATION_CONFIGURED                                   | SYSTEM no CLI; USER na API      | INTEGRATION                          |

## Consulta e interface

GET /audit e GET /audit/:id exigem audit.view (CLINIC_ADMIN). Serviços revalidam
permissão e aplicam tenant/sessão/RBAC na própria query. UUID externo retorna o mesmo
404 de recurso inexistente. Filtros: resourceType/resourceId/action/actorType/
actorUserId/source/correlationId/dateFrom/dateTo. Datas ISO com offset obrigatório;
page >=1, limite padrão 25, máximo 100, máximo 10000 páginas; ordenação createdAt/id
DESC. Sem exportação massiva. A tela /settings/audit usa exatamente essas rotas,
filtros, paginação e detalhes before/after/metadata. Ator humano é mostrado pelo ID
preservado, sem join de identidade global.

Índices: tenant+createdAt DESC+id DESC, tenant+resourceType+resourceId,
tenant+type, tenant+userId, tenant+source, correlationId. JSON não é indexado.

## Fronteiras existentes e retenção

Não existem CRUDs operacionais de roles/permissões/usuários no MVP atual. A task
não inventa esses endpoints: concessão local de membership é auditada; seed do catálogo
é operação técnica de implantação. Ao implementar administração, remoções/concessões
precisam chamar a mesma infraestrutura com before/after e ator autenticado.
Identidade global permanece no histórico técnico/segurança, sem tenant artificial.
Sem retenção destrutiva automática; política de arquivamento deve ser definida antes
de criar limpeza. Rollback mantém colunas e dados adicionados, sem apagar histórico.
