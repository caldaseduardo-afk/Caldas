import {
  expect,
  test,
  type BrowserContext,
  type WebSocketRoute,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
const tenantA = '11111111-1111-4111-8111-111111111111',
  tenantB = '22222222-2222-4222-8222-222222222222';
const a = '33333333-3333-4333-8333-333333333333',
  b = '44444444-4444-4444-8444-444444444444';
async function fixture(context: BrowserContext) {
  let active = tenantA,
    logged = true,
    closed = 0;
  const sockets: WebSocketRoute[] = [],
    calls: string[] = [];
  const conversations = [a, b].map((id, i) => ({
    id,
    assignedUserId: a,
    handoffReason: 'OTHER',
    handoffRequestedAt: '2026-10-02T17:00:00Z',
    assignedAt: '2026-10-02T17:00:00Z',
    resolvedAt: null,
    channel: 'WHATSAPP',
    status: 'HUMAN_ACTIVE',
    intent: 'OTHER',
    lastMessageAt: `2026-10-03T1${i}:00:00.000Z`,
    contact: {
      id,
      displayName: i ? 'Bruno' : 'Alice',
      channels: [{ address: '+5561999999999', type: 'WHATSAPP' }],
    },
    assignedUser: null as { user: { name: string } } | null,
    activePatient: null as { id: string; name: string } | null,
    messages: [
      { content: i ? 'Mensagem Bruno' : 'Mensagem Alice', messageType: 'TEXT' },
    ],
  }));
  const histories = new Map(
    conversations.map((c) => [
      c.id,
      [
        {
          id: randomUUID(),
          senderType: 'PATIENT',
          senderUser: null,
          messageType: 'TEXT',
          content: c.messages[0]!.content,
          createdAt: c.lastMessageAt,
          metadata: {},
        },
      ],
    ]),
  );
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/', '');
    calls.push(path);
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data });
    if (path === 'auth/me') return json({ name: 'Ana' }, logged ? 200 : 401);
    if (path === 'auth/logout') {
      logged = false;
      return route.fulfill({ status: 204 });
    }
    if (path === 'tenancy/tenants')
      return json([
        { id: tenantA, name: 'Clínica A', timezone: 'UTC' },
        { id: tenantB, name: 'Clínica B', timezone: 'UTC' },
      ]);
    if (path === 'tenancy/active') {
      active = route.request().postDataJSON().tenantId;
      return json({ tenantId: active });
    }
    if (path === 'inbox/session')
      return json({
        tenant: {
          id: active,
          name: active === tenantA ? 'Clínica A' : 'Clínica B',
          timezone: 'UTC',
        },
        userId: a,
        canAssign: true,
        canTransfer: true,
        canClose: true,
        canReply: true,
        canViewPatients: true,
        canViewAppointments: true,
      });
    if (path === 'inbox/conversations')
      return json({
        items:
          active === tenantA
            ? [...conversations].sort((x, y) =>
                y.lastMessageAt.localeCompare(x.lastMessageAt),
              )
            : [],
        page: 1,
        limit: 20,
        hasMore: false,
      });
    const id = path.split('/')[2],
      conv = conversations.find((c) => c.id === id);
    if (conv && path.endsWith('/messages'))
      return json({ items: histories.get(id!), before: null });
    if (conv) return json({ ...conv, links: [], appointment: null });
    return json({}, 404);
  });
  await context.routeWebSocket('**/realtime', (socket) => {
    sockets.push(socket);
    socket.onClose(() => {
      closed++;
    });
    socket.send(JSON.stringify({ type: 'realtime.ready', tenantId: active }));
  });
  const publish = (
    type = 'message.created',
    id = a,
    eventId = randomUUID(),
    tenantId = active,
  ) => {
    const payload = JSON.stringify({
      type,
      conversationId: id,
      tenantId,
      eventId,
    });
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        /* already closed */
      }
    }
    return eventId;
  };
  function add(content: string) {
    const c = conversations[0]!;
    const createdAt = new Date(
      new Date(c.lastMessageAt).getTime() + 7200000,
    ).toISOString();
    c.lastMessageAt = createdAt;
    c.messages = [{ content, messageType: 'TEXT' }];
    histories.get(a)!.push({
      id: randomUUID(),
      senderType: 'PATIENT',
      senderUser: null,
      messageType: 'TEXT',
      content,
      createdAt,
      metadata: {},
    });
  }
  return { sockets, calls, conversations, publish, add, closed: () => closed };
}
test('duas janelas: nova mensagem, lista/ordem/lastMessageAt sem duplicar e draft preservado', async ({
  context,
  page,
}) => {
  const f = await fixture(context);
  const second = await context.newPage();
  await page.goto(`/conversations?conversationId=${a}`);
  await second.goto('/conversations');
  await expect(
    page.getByText('Tempo real conectado', { exact: true }),
  ).toBeVisible();
  await expect(
    second.getByText('Tempo real conectado', { exact: true }),
  ).toBeVisible();
  await expect(
    second
      .getByLabel('Lista de conversas')
      .locator('.conversation-item')
      .first(),
  ).toContainText('Bruno');
  await page.getByLabel('Mensagem do atendente').fill('Rascunho preservado');
  f.add('Chegou pelo evento');
  const eventId = f.publish();
  f.publish('message.created', a, eventId);
  await expect(
    page
      .getByLabel('Histórico de mensagens')
      .getByText('Chegou pelo evento', { exact: true }),
  ).toHaveCount(1);
  await expect(
    second
      .getByLabel('Lista de conversas')
      .locator('.conversation-item')
      .first(),
  ).toContainText('Alice');
  await expect(
    second
      .getByLabel('Lista de conversas')
      .locator('.conversation-item')
      .first(),
  ).toContainText('03/10/2026, 12:00');
  await expect(page.getByLabel('Mensagem do atendente')).toHaveValue(
    'Rascunho preservado',
  );
  expect(f.sockets).toHaveLength(2);
});
test('eventos antigos não regridem status; contexto e responsável são relidos', async ({
  context,
  page,
}) => {
  const f = await fixture(context);
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(page.getByRole('heading', { name: 'Alice' })).toBeVisible();
  f.conversations[0]!.status = 'HUMAN_ACTIVE';
  f.conversations[0]!.assignedUser = { user: { name: 'Beatriz' } };
  f.conversations[0]!.activePatient = { id: b, name: 'Paciente atual' };
  f.publish('conversation.status_changed');
  f.publish('conversation.assigned');
  f.publish('conversation.active_patient_changed');
  await expect(
    page.getByLabel('Conversa ativa').getByText('Responsável: Beatriz'),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Conversa ativa')
      .getByText('Falando sobre: Paciente atual'),
  ).toBeVisible();
  f.publish('conversation.updated');
  await expect(
    page.getByLabel('Conversa ativa').getByText('Humano', { exact: true }),
  ).toBeVisible();
});
test('queda mantém REST; reconnect ressincroniza eventos perdidos sem duplicar', async ({
  context,
  page,
}) => {
  const f = await fixture(context);
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(
    page.getByText('Tempo real conectado', { exact: true }),
  ).toBeVisible();
  await f.sockets[0]!.close({ code: 1012 });
  await expect(
    page.getByText('Reconectando… A consulta por API continua disponível.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alice' })).toBeVisible();
  f.add('Persistida durante a queda');
  await expect.poll(() => f.sockets.length).toBe(2);
  await expect(
    page.getByText('Tempo real conectado', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Histórico de mensagens')
      .getByText('Persistida durante a queda', { exact: true }),
  ).toHaveCount(1);
});
test('troca de conversa não cria sockets/listeners; tenant e logout limpam conexão', async ({
  context,
  page,
}) => {
  const f = await fixture(context);
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(
    page.getByText('Tempo real conectado', { exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Bruno/ }).click();
    await expect(page.getByRole('heading', { name: 'Bruno' })).toBeVisible();
    await page.getByRole('button', { name: /Alice/ }).click();
    await expect(page.getByRole('heading', { name: 'Alice' })).toBeVisible();
  }
  expect(f.sockets).toHaveLength(1);
  await page.getByLabel('Clínica ativa').selectOption(tenantB);
  await expect(page.getByText('Não há conversas para exibir.')).toBeVisible();
  await expect.poll(() => f.closed()).toBeGreaterThanOrEqual(1);
  await expect.poll(() => f.sockets.length).toBe(2);
  const before = f.calls.length;
  f.publish('conversation.updated', a, randomUUID(), tenantA);
  await page.waitForTimeout(200);
  expect(f.calls.length).toBe(before);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await expect.poll(() => f.closed()).toBeGreaterThanOrEqual(2);
});
