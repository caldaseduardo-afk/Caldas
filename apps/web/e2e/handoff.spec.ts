import {
  expect,
  test,
  type BrowserContext,
  type WebSocketRoute,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
const tenantId = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  ana = '33333333-3333-4333-8333-333333333333',
  carlos = '44444444-4444-4444-8444-444444444444';
async function fixture(context: BrowserContext) {
  const sockets: WebSocketRoute[] = [];
  const conversation = {
    id,
    channel: 'WHATSAPP',
    status: 'NEEDS_HUMAN',
    slaLevel: 'NONE',
    intent: 'OTHER',
    assignedUserId: null as string | null,
    assignedUser: null as { user: { name: string } } | null,
    handoffReason: 'USER_REQUESTED_HUMAN',
    handoffRequestedAt: '2026-10-03T10:00:00Z',
    assignedAt: null as string | null,
    resolvedAt: null as string | null,
    lastMessageAt: null,
    contact: { id, displayName: 'Contato da fila', channels: [] },
    activePatient: null,
    messages: [],
    links: [],
    appointment: null,
  };
  const publish = (type = 'conversation.assigned') =>
    sockets.forEach((s) =>
      s.send(
        JSON.stringify({
          eventId: randomUUID(),
          type,
          tenantId,
          conversationId: id,
        }),
      ),
    );
  await context.routeWebSocket('**/realtime', (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: 'realtime.ready', tenantId }));
  });
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace('/api/', '');
    const actor =
      new URL(request.frame().url()).searchParams.get('operator') === 'carlos'
        ? carlos
        : ana;
    const json = (data: unknown, status = 200) =>
      route.fulfill({ json: data, status });
    if (path === 'auth/me')
      return json({ name: actor === ana ? 'Ana' : 'Carlos' });
    const tenant = { id: tenantId, name: 'Clínica', timezone: 'UTC' };
    if (path === 'tenancy/tenants') return json([tenant]);
    if (path === 'inbox/session')
      return json({
        tenant,
        userId: actor,
        canReply: true,
        canAssign: true,
        canTransfer: true,
        canClose: true,
        canViewPatients: false,
        canViewAppointments: false,
      });
    if (path === 'inbox/assignees')
      return json({
        items: [
          { id: ana, name: 'Ana' },
          { id: carlos, name: 'Carlos' },
        ],
        hasMore: false,
      });
    if (path === 'inbox/conversations')
      return json({ items: [conversation], page: 1, hasMore: false });
    if (path === `inbox/conversations/${id}`) return json(conversation);
    if (path === `inbox/conversations/${id}/messages`)
      return json({ items: [], before: null });
    if (path === `conversations/${id}/claim`) {
      if (conversation.status !== 'NEEDS_HUMAN') return json({}, 409);
      conversation.status = 'HUMAN_ACTIVE';
      conversation.assignedUserId = actor;
      conversation.assignedUser = {
        user: { name: actor === ana ? 'Ana' : 'Carlos' },
      };
      conversation.assignedAt = new Date().toISOString();
      await json(conversation);
      publish();
      return;
    }
    if (path === `conversations/${id}/transfer`) {
      conversation.assignedUserId = request.postDataJSON().targetUserId;
      conversation.assignedUser = {
        user: { name: conversation.assignedUserId === ana ? 'Ana' : 'Carlos' },
      };
      await json(conversation);
      publish();
      return;
    }
    if (path.endsWith('/return-to-ai') || path.endsWith('/resolve')) {
      conversation.status = path.endsWith('/resolve')
        ? 'RESOLVED'
        : 'AI_ACTIVE';
      conversation.assignedUserId = null;
      conversation.assignedUser = null;
      await json(conversation);
      publish();
      return;
    }
    return json({}, 404);
  });
  return { conversation, publish };
}
test('duas janelas: assumir, bloquear outro composer, transferir e devolver à IA', async ({
  context,
}) => {
  await fixture(context);
  const a = await context.newPage(),
    b = await context.newPage();
  await a.goto(`/conversations?conversationId=${id}`);
  await b.goto(`/conversations?conversationId=${id}&operator=carlos`);
  await expect(
    a.getByRole('button', { name: 'Assumir conversa' }),
  ).toBeVisible();
  await expect(
    b.getByRole('button', { name: 'Assumir conversa' }),
  ).toBeVisible();
  await a.getByRole('button', { name: 'Assumir conversa' }).click();
  await expect(a.getByRole('textbox', { name: 'Mensagem' })).toBeEnabled();
  await expect(
    b.getByText('Em atendimento por Ana', { exact: true }),
  ).toBeVisible();
  await expect(b.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
  await a.getByRole('button', { name: 'Transferir', exact: true }).click();
  await a.getByLabel('Novo responsável').selectOption(carlos);
  await a.getByRole('button', { name: 'Confirmar transferência' }).click();
  await expect(a.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
  await expect(b.getByRole('textbox', { name: 'Mensagem' })).toBeEnabled();
  await b.getByRole('button', { name: 'Devolver para IA' }).click();
  await expect(a.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
  await expect(
    b.getByRole('button', { name: 'Solicitar humano' }),
  ).toBeVisible();
});
test('409 ao assumir atualiza responsável e bloqueia composer; resolução permanece RESOLVED', async ({
  context,
  page,
}) => {
  const f = await fixture(context);
  await page.goto(`/conversations?conversationId=${id}`);
  await expect(
    page.getByRole('button', { name: 'Assumir conversa' }),
  ).toBeVisible();
  f.conversation.status = 'HUMAN_ACTIVE';
  f.conversation.assignedUserId = carlos;
  f.conversation.assignedUser = { user: { name: 'Carlos' } };
  await page.getByRole('button', { name: 'Assumir conversa' }).click();
  await expect(
    page.getByLabel('Atendimento humano').getByRole('alert'),
  ).toContainText('já foi assumida');
  await expect(
    page.getByText('Em atendimento por Carlos', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
  f.conversation.assignedUserId = ana;
  f.conversation.assignedUser = { user: { name: 'Ana' } };
  f.publish();
  await page.getByRole('button', { name: 'Encerrar atendimento' }).click();
  await expect(
    page.getByLabel('Conversa ativa').getByText('Resolvida', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
});

test('SLA: contador com relógio controlado, níveis por realtime e limpeza após claim', async ({
  context,
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-04T10:07:00Z') });
  const f = await fixture(context);
  f.conversation.handoffRequestedAt = '2026-10-04T10:00:00Z';
  await page.goto(`/conversations?conversationId=${id}`);
  const controls = page.getByLabel('Atendimento humano');
  await expect(controls).toContainText('Aguardando há 7 min');
  await page.clock.fastForward(60000);
  await expect(controls).toContainText('Aguardando há 8 min');
  for (const [level, label] of [
    ['FIRST', 'Alerta SLA'],
    ['SECOND', 'Alerta crítico'],
    ['EXTERNAL', 'Alerta externo requerido'],
  ]) {
    f.conversation.slaLevel = level!;
    f.publish('conversation.sla_updated');
    await expect(controls).toContainText(label!);
    await expect(page.getByLabel('Lista de conversas')).toContainText(label!);
  }
  await page.getByRole('button', { name: 'Assumir conversa' }).click();
  await expect(controls).toContainText('Em atendimento por Ana');
  await expect(controls).not.toContainText('Aguardando há');
  await expect(page.locator('.sla-indicator')).toHaveCount(0);
});
