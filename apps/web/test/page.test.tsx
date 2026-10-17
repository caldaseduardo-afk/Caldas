import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import Home from '../app/page';

test('página inicial oferece acesso à inbox', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.match(html, /<h1>Atendente IA<\/h1>/);
  assert.match(html, /Abrir inbox/);
});
