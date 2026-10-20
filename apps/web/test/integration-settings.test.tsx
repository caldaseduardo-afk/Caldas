import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntegrationSettings } from '../components/settings/integration-settings';

test('integrações identificam campos Meta e explicam os limites da simulação', () => {
  const html = renderToStaticMarkup(<IntegrationSettings />);
  assert.match(html, /Phone Number ID/);
  assert.match(html, /WhatsApp Business Account ID/);
  assert.match(html, /Token de acesso permanente/);
  assert.match(html, /Simular conexão/);
  assert.match(html, /Simulação visual apenas/);
  assert.match(html, /não envia nem recebe mensagens/);
});
