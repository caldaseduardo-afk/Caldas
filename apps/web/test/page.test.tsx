import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import Home from '../app/page';

test('página inicial organiza o acesso às áreas disponíveis', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.match(html, /Como podemos ajudar hoje\?/);
  assert.match(html, /Atendente IA/);
  for (const path of [
    '/conversations',
    '/dashboard',
    '/agenda',
    '/settings/ai',
    '/settings/integrations',
    '/settings/audit',
    '/settings/plan',
  ]) assert.match(html, new RegExp(`href="${path.replaceAll('/', '\\/')}"`));
  assert.match(html, /Áreas da clínica/);
});
