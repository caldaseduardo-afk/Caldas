import { test, expect } from '@playwright/test';
const id = '11111111-1111-4111-8111-111111111111';
const fixture = {
  period: { from: '2026-10-01', to: '2026-10-17', timezone: 'UTC' },
  tenant: null,
  summary: {
    tenants: 3,
    active: 2,
    suspended: 1,
    users: 10,
    conversations: 28,
    messages: 150,
    appointments: 15,
    tokens: 15000, failedIntegrations: 2, tenantsWithIncidents: 1, aiRequests: 2, totalUsers: 10, units: 2,
  },
  clinics: [
    {
      id,
      name: 'Clínica B',
      status: 'ACTIVE',
      timezone: 'America/Sao_Paulo',
      createdAt: '2026-01-01',
      users: 3,
      messages: 50,
      conversations: 8,
      appointments: 5,
      tokens: 5000,
      lastActivity: '2026-10-17',
    },
  ],
  totalClinics: 1,
  page: 1,
  limit: 25,
  usage: [],
  integrations: [
    {
      tenantId: id,
      id,
      tenantName: 'Clínica B',
      type: 'WHATSAPP',
      status: 'ERROR',
      errorCode: 'DELIVERY_ERROR',
      lastTestedAt: null,
    },
  ],
  incidents: [
    { tenantId: id, type: 'INTEGRATION', severity: 'CRITICAL', count: 2 },
  ],
  groups: [],
  series: [],
  webhookErrors: null,
};
test('Super Admin: capability, totais, drill-down e falha parcial de health', async ({
  page,
}) => {
  await page.route('**/api/super-admin/session', (route) =>
    route.fulfill({ json: { role: 'SUPER_ADMIN' } }),
  );
  await page.route('**/api/super-admin/overview?*', (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route('**/api/super-admin/health', (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.route('**/api/super-admin/tenants/*', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        tenant: { id, name: 'Clínica B', status: 'ACTIVE' },
        summary: { ...fixture.summary, messages: 50, tokens: 5000 },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Super Admin' })).toBeVisible();
  await page.getByRole('link', { name: 'Super Admin' }).click();
  await expect(
    page
      .locator('.dashboard-metric')
      .filter({
        has: page.getByRole('heading', { name: 'Mensagens', exact: true }),
      })
      .locator('strong'),
  ).toHaveText('150');
  await page.screenshot({
    path: '/tmp/task032-super-admin.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Clínicas', exact: true }).click();
  await page.getByRole('button', { name: 'Clínica B', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Super Admin · Clínica B', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.dashboard-metric')
      .filter({
        has: page.getByRole('heading', { name: 'Mensagens', exact: true }),
      })
      .locator('strong'),
  ).toHaveText('50');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'DELIVERY_ERROR', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await expect(page.getByText('Saúde das filas indisponível.')).toBeVisible();
  await page.getByRole('button', { name: 'Incidentes', exact: true }).click();
  await expect(
    page.getByText('CRITICAL · Plataforma: sem heartbeat recente confirmado.'),
  ).toBeVisible();
});
test('não autenticado não recebe menu nem consulta overview', async ({
  page,
}) => {
  let overviewRequests = 0;
  await page.route('**/api/super-admin/session', (route) =>
    route.fulfill({ status: 403 }),
  );
  await page.route('**/api/super-admin/overview?*', (route) => {
    overviewRequests++;
    return route.fulfill({ status: 403 });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Super Admin' })).toHaveCount(0);
  await page.goto('/super-admin');
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeVisible();
  expect(overviewRequests).toBe(0);
  await expect(
    page.getByRole('navigation', { name: 'Seções do Super Admin' }),
  ).toHaveCount(0);
});
