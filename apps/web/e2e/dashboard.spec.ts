import { test, expect } from '@playwright/test';
import { dashboardFixture } from '../test/dashboard-fixture';
const unit = '11111111-1111-4111-8111-111111111111';
test('dashboard: período, filtros, refresh, gráficos, rankings e desktop', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/api/analytics/dashboard/options?*', (route) =>
    route.fulfill({
      json: {
        items: [{ id: unit, name: 'Unidade Centro' }],
        page: 1,
        hasMore: false,
      },
    }),
  );
  await page.route(/\/api\/analytics\/dashboard\?/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const total = url.searchParams.has('unitId')
      ? 2
      : url.searchParams.get('period') === 'LAST_7_DAYS'
        ? 3
        : 9;
    return route.fulfill({ json: dashboardFixture(total) });
  });
  await page.goto('/dashboard');
  const metric = page.locator('.dashboard-metric').filter({
    has: page.getByRole('heading', {
      name: 'Consultas agendadas',
      exact: true,
    }),
  });
  await expect(metric.locator('strong')).toHaveText('9');
  await page.getByLabel('Período', { exact: true }).selectOption('LAST_7_DAYS');
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(metric.locator('strong')).toHaveText('3');
  await expect(
    page.getByRole('img', { name: 'Evolução das consultas', exact: true }),
  ).toContainText('Total 3');
  await expect(
    page
      .getByRole('heading', { name: 'Top 5 serviços' })
      .locator('..')
      .locator('strong'),
  ).toHaveText('3');
  await page
    .getByLabel('Período', { exact: true })
    .selectOption('LAST_30_DAYS');
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(metric.locator('strong')).toHaveText('9');
  await page.getByLabel('Unidade', { exact: true }).selectOption(unit);
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(metric.locator('strong')).toHaveText('2');
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(metric.locator('strong')).toHaveText('2');
  expect(requests.at(-1)).toContain('unitId=' + unit);
  expect(requests.at(-1)).toContain('period=LAST_30_DAYS');
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: '/tmp/task031-dashboard.png', fullPage: true });
});
test('dashboard: loading, vazio, erro e 403 sem conteúdo antigo', async ({
  page,
}) => {
  await page.route('**/api/analytics/dashboard/options?*', (route) =>
    route.fulfill({ json: { items: [], page: 1, hasMore: false } }),
  );
  let status = 200;
  await page.route(/\/api\/analytics\/dashboard\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status,
      json: status === 200 ? dashboardFixture(0) : { message: 'error' },
    });
  });
  await page.goto('/dashboard');
  await expect(
    page
      .getByRole('status', { name: '' })
      .filter({ hasText: 'Carregando indicadores' }),
  ).toBeVisible();
  await expect(
    page.getByText('Sem dados no período selecionado.').first(),
  ).toBeVisible();
  status = 500;
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Não foi possível',
  );
  status = 403;
  await page.getByRole('button', { name: 'Aplicar / atualizar' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Sem permissão para acessar o dashboard.',
  );
  await expect(
    page.getByRole('heading', { name: 'Agenda no período' }),
  ).toHaveCount(0);
});
