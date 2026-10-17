import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../app/api/[...path]/route';
test('proxy preserva cookie e Origin; nenhuma autorização/tenant é forjada', async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      captured = init;
      return Response.json(
        { name: 'Usuário' },
        {
          headers: {
            'Set-Cookie':
              'atendente_session=opaque; HttpOnly; SameSite=Strict; Path=/',
          },
        },
      );
    },
  );
  const response = await POST(
    new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.test',
        Cookie: 'atendente_session=old',
      },
      body: '{}',
    }),
    { params: Promise.resolve({ path: ['auth', 'login'] }) },
  );
  assert.equal(response.status, 200);
  assert.equal(
    new Headers(captured!.headers).get('origin'),
    'https://untrusted.test',
  );
  assert.equal(
    new Headers(captured!.headers).get('cookie'),
    'atendente_session=old',
  );
  assert.equal(captured!.cache, 'no-store');
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('proxy não encaminha rotas arbitrárias e limita payload', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({}),
  );
  assert.equal(
    (
      await GET(new Request('http://localhost/api/patients'), {
        params: Promise.resolve({ path: ['patients'] }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await POST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          body: 'x'.repeat(8193),
        }),
        { params: Promise.resolve({ path: ['auth', 'login'] }) },
      )
    ).status,
    413,
  );
  assert.equal(mock.mock.callCount(), 0);
});
test('proxy remove detalhes internos de erros e não inventa Origin ausente', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      assert.equal(new Headers(init.headers).get('origin'), null);
      return Response.json({ stack: 'SQL segredo interno' }, { status: 403 });
    },
  );
  const response = await POST(
    new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    { params: Promise.resolve({ path: ['auth', 'logout'] }) },
  );
  assert.equal(response.status, 403);
  assert(!JSON.stringify(await response.json()).includes('SQL'));
});
