import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ClinicDashboard,
  DashboardContent,
  duration,
  percent,
} from '../components/dashboard/dashboard';
import { dashboardFixture } from './dashboard-fixture';
import { allowedPath } from '../lib/proxy';
test('Dashboard: números, percentuais, duração, loading e fórmulas visíveis', () => {
  assert.equal(duration(240), '04m 00s');
  assert.equal(duration(null), 'Sem dados');
  assert.equal(duration(59.9), '01m 00s');
  assert.equal(percent(85.71), '85,71%');
  const html = renderToStaticMarkup(
    <DashboardContent data={dashboardFixture()} />,
  );
  for (const text of [
    '85,71%',
    '22,22%',
    '04m 00s',
    'Agenda no período',
    'Atendimento agora',
    'Evolução das consultas',
    'Top 5 serviços',
  ])
    assert(html.includes(text));
  assert(
    renderToStaticMarkup(<ClinicDashboard />).includes(
      'Carregando indicadores',
    ),
  );
});
test('Dashboard: zeros, escape HTML, gráficos acessíveis e proxy somente leitura', () => {
  const empty = renderToStaticMarkup(
    <DashboardContent data={dashboardFixture(0)} />,
  );
  assert(empty.includes('Sem dados no período selecionado'));
  assert(!empty.includes('NaN'));
  const data = dashboardFixture();
  data.rankings[0].name = '<script>bad()</script>';
  const html = renderToStaticMarkup(<DashboardContent data={data} />);
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('role="img"'));
  assert(html.includes('Valores diários acessíveis'));
  assert(allowedPath('GET', 'analytics/dashboard'));
  assert(allowedPath('GET', 'analytics/dashboard/options'));
  assert(!allowedPath('POST', 'analytics/dashboard'));
  assert(!allowedPath('GET', 'analytics/global'));
});
