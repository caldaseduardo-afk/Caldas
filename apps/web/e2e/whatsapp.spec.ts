import { test, expect, type WebSocketRoute } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const tenantId = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  userId = '33333333-3333-4333-8333-333333333333';
test('WhatsApp: retry HTTP preserva intenção; recibos realtime atualizam a mensagem', async ({
  page,
}) => {
  let socket: WebSocketRoute | undefined,
    attempts = 0,
    status = 'PENDING';
  const keys: string[] = [];
  const messageId = randomUUID();
  const conversation = {
    id,
    integrationId: randomUUID(),
    channel: 'WHATSAPP',
    status: 'HUMAN_ACTIVE',
    intent: 'OTHER',
    assignedUserId: userId,
    assignedUser: { user: { name: 'Ana' } },
    slaLevel: 'NONE',
    handoffReason: null,
    handoffRequestedAt: null,
    assignedAt: '2026-10-05T12:00:00Z',
    resolvedAt: null,
    lastMessageAt: null,
    contact: {
      id,
      displayName: 'Contato WhatsApp',
      channels: [{ address: '+5561999999999', type: 'WHATSAPP' }],
    },
    activePatient: null,
    messages: [],
  };
  await page.routeWebSocket('**/realtime', (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'realtime.ready', tenantId }));
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/', '');
    if (path === 'auth/me')
      return route.fulfill({ json: { id: userId, name: 'Ana' } });
    if (path === 'tenancy/tenants')
      return route.fulfill({
        json: [{ id: tenantId, name: 'Clínica', timezone: 'UTC' }],
      });
    if (path === 'inbox/session')
      return route.fulfill({
        json: {
          tenant: { id: tenantId, name: 'Clínica', timezone: 'UTC' },
          userId,
          canReply: true,
          canAssign: true,
          canTransfer: true,
          canClose: true,
          canViewPatients: false,
          canViewAppointments: false,
        },
      });
    if (path === 'inbox/conversations')
      return route.fulfill({
        json: { items: [conversation], page: 1, limit: 20, hasMore: false },
      });
    if (path === `inbox/conversations/${id}`)
      return route.fulfill({
        json: { ...conversation, links: [], appointment: null },
      });
    if (path === `inbox/conversations/${id}/messages`)
      return route.fulfill({
        json: {
          items: attempts
            ? [
                {
                  id: messageId,
                  senderType: 'USER',
                  senderUser: { user: { name: 'Ana' } },
                  messageType: 'TEXT',
                  content: 'Resposta WhatsApp',
                  metadata: {},
                  createdAt: '2026-10-05T12:00:00Z',
                  deliveryStatus: status,
                },
              ]
            : [],
          before: null,
        },
      });
    if (path === `conversations/${id}/messages`) {
      keys.push(route.request().postDataJSON().requestId);
      attempts++;
      return route.fulfill({
        status: attempts === 1 ? 503 : 201,
        json:
          attempts === 1
            ? { message: 'Resposta perdida' }
            : { id: messageId, deliveryStatus: status },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`/conversations?conversationId=${id}`);
  await page.getByLabel('Mensagem do atendente').fill('Resposta WhatsApp');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(
    page.getByText('Não foi possível confirmar a gravação.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(
    page.getByText('Mensagem registrada para envio ao WhatsApp.'),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    page.getByText('Aguardando envio', { exact: true }),
  ).toBeVisible();
  for (const [next, label] of [
    ['SENT', 'Enviada'],
    ['DELIVERED', 'Entregue'],
    ['READ', 'Lida'],
  ]) {
    status = next!;
    socket!.send(
      JSON.stringify({
        type: 'message.status_updated',
        eventId: randomUUID(),
        tenantId,
        conversationId: id,
        messageId,
      }),
    );
    await expect(page.getByText(label!, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.messages > li')).toHaveCount(1);
});
