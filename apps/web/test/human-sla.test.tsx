import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlaIndicator } from '../components/inbox/sla-indicator';
import { waitingLabel } from '../lib/human-sla';
test('espera e níveis SLA usam texto, contador derivado e ocultam ao assumir', () => {
  const start = '2026-10-04T10:00:00Z',
    now = Date.parse('2026-10-04T10:07:00Z');
  assert.equal(waitingLabel(start, now), 'Aguardando há 7 min');
  assert.equal(
    waitingLabel(start, Date.parse(start) - 1),
    'Aguardando há 0 min',
  );
  for (const [level, label] of [
    ['FIRST', 'Alerta SLA'],
    ['SECOND', 'Alerta crítico'],
    ['EXTERNAL', 'Alerta externo requerido'],
  ] as const) {
    const html = renderToStaticMarkup(
      <SlaIndicator
        conversation={{
          status: 'NEEDS_HUMAN',
          handoffRequestedAt: start,
          slaLevel: level,
        }}
        now={now}
      />,
    );
    assert(html.includes(label));
    assert(html.includes('Aguardando há 7 min'));
    assert.equal(
      renderToStaticMarkup(
        <SlaIndicator
          conversation={{
            status: 'HUMAN_ACTIVE',
            handoffRequestedAt: start,
            slaLevel: level,
          }}
          now={now}
        />,
      ),
      '',
    );
  }
});
