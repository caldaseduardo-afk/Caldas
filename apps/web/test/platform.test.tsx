import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PlatformMenu,
  PlatformDashboard,
} from '../components/platform/platform-dashboard';
import { allowedPath } from '../lib/proxy';
test('SSR não revela menu nem métricas de plataforma antes da autorização', () => {
  assert.equal(renderToStaticMarkup(<PlatformMenu />), '');
  const page = renderToStaticMarkup(<PlatformDashboard />);
  assert.match(page, /Verificando acesso/);
  assert.doesNotMatch(page, /Tokens|Integrações|Usuários ativos/);
});
test('proxy de plataforma permite apenas rotas e métodos fixos', () => {
  for (const path of ['overview', 'health', 'session'])
    assert.equal(allowedPath('GET', 'super-admin/' + path), true);
  for (const path of ['login', 'enroll', 'logout'])
    assert.equal(allowedPath('POST', 'super-admin/' + path), true);
  for (const path of ['sql', 'jobs/retry', 'grant', 'tenants/all/messages'])
    assert.equal(allowedPath('POST', 'super-admin/' + path), false);
  assert.equal(allowedPath('DELETE', 'super-admin/overview'), false);
  assert.equal(allowedPath('GET', 'plans/current'), true);
  assert.equal(allowedPath('GET', 'plans/catalog'), true);
  assert.equal(allowedPath('PATCH', `super-admin/tenants/${'00000000-0000-4000-8000-000000000000'}/subscription`), true);
  assert.equal(allowedPath('POST', `super-admin/tenants/${'00000000-0000-4000-8000-000000000000'}/subscription`), false);
});
