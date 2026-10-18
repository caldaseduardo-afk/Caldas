# Planos e consumo

`TenantSubscription` mantém uma assinatura administrativa por tenant. O catálogo
de BASIC, PRO e ENTERPRISE e as capabilities ficam centralizados em
`packages/domain/src/plans.ts`. As métricas mensais são agregadas diretamente
das tabelas-fonte dentro do ciclo UTC `[currentPeriodStart, currentPeriodEnd)`;
não há contador paralelo. Uma nova agregação reconcilia o uso e evita duplicação
por retries de eventos.

Unidades, membros ativos, integrações ativas e artigos da base de conhecimento
usam limites rígidos na criação/ativação. Requests/tokens de IA são soft limits;
mensagens, profissionais e consultas são medidos, sem bloquear atendimento,
webhook inbound, transições de conversa ou consultas existentes. Mensagens são
contabilizadas em conjunto para comparar com o limite e a resposta também
preserva o detalhamento inbound/outbound.

Alertas aparecem em 70%, 85% e 100%. Períodos vencidos avançam ao serem lidos;
um plano agendado começa no próximo ciclo. Upgrades imediatos preservam o ciclo.
GRACE, SUSPENDED e CANCELLED não removem dados e não encerram fluxo operacional;
o backend restringe novas criações hard-limit e capabilities premium conforme
estado e plano.

As capabilities efetivas são a interseção do plano, dos controles disponíveis à
plataforma e dos overrides. Um override de tenant não consegue adicionar recurso
ausente no plano. Overrides e mudanças de assinatura só podem ser definidos pelo
Super Admin, com autoria e tenant auditados. Clinic Admin tem leitura por
`billing.view`. Não há processamento de pagamentos, invoices ou integração de
billing nesta tarefa.

Assinaturas existentes recebem BASIC/ACTIVE no ciclo civil UTC corrente. A
migration cria assinaturas padrão para novos tenants por trigger transacional,
para não haver estado de tenant sem plano mesmo em caminhos de provisionamento
fora da API.
