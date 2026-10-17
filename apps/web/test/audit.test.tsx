import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuditDetails,
  type AuditItem,
} from '../components/settings/audit-settings';
import { allowedPath } from '../lib/proxy';
test('auditoria renderiza JSON como texto e proxy permite apenas leitura', () => {
  const item = {
    action: 'APPOINTMENT_CANCELLED',
    metadata: { x: '<script>alert(1)</script>' },
    previousValues: { status: 'CONFIRMED' },
    newValues: { status: 'CANCELLED' },
  } as AuditItem;
  const html = renderToStaticMarkup(<AuditDetails item={item} />);
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;'));
  assert(allowedPath('GET', 'audit'));
  assert(!allowedPath('POST', 'audit'));
  assert(!allowedPath('DELETE', 'audit/00000000-0000-0000-0000-000000000000'));
});
