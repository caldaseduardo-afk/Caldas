import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import AISettingsPage from '../app/settings/ai/page';
import { allowedPath } from '../lib/proxy';

test('tela de IA expõe ciclo editorial e simulação segura', () => {
  const html = renderToStaticMarkup(<AISettingsPage />);
  assert.match(html, /Assistente de IA/);
  assert.match(html, /simule sem efeitos/);
  assert.match(html, /Simulação segura/);
});
test('proxy permite somente endpoints administrativos explícitos da configuração', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(allowedPath('GET', 'ai-configuration/versions'), true);
  assert.equal(
    allowedPath('POST', `ai-configuration/versions/${id}/simulate`),
    true,
  );
  assert.equal(allowedPath('PATCH', `ai-configuration/versions/${id}`), true);
  assert.equal(allowedPath('DELETE', `ai-configuration/versions/${id}`), false);
  assert.equal(allowedPath('POST', 'ai-configuration/arbitrary'), false);
});
