import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseClient } from '../src';
import {
  CalendarProviderError,
  GoogleCalendarProvider,
  calendarReconciliationHorizon,
  calendarSyncJobId,
  googleCalendarCredentials,
  parseCalendarSyncPayload,
} from '../src';
import { randomUUID } from 'node:crypto';
import { assertDevelopmentSeed } from '../src/development-seed';

test('seed recusa ambiente diferente de development', () => {
  for (const environment of [undefined, 'production', 'test', '']) {
    assert.throws(() => assertDevelopmentSeed(environment));
  }
  assert.doesNotThrow(() => assertDevelopmentSeed('development'));
});

test('conexão exige URL PostgreSQL explícita', () => {
  for (const url of ['', '  ', 'https://localhost', 'inválida']) {
    assert.throws(() => createDatabaseClient(url));
  }
});

test('URL inválida não expõe credenciais no erro', () => {
  assert.throws(
    () => createDatabaseClient('postgresql://user:segredo@'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'DATABASE_URL inválida.');
      assert.equal('input' in error, false);
      return true;
    },
  );
});

test('Google Calendar usa OAuth por referência e envia somente campos administrativos permitidos', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('oauth2.googleapis.com'))
      return new Response(JSON.stringify({ access_token: 'access-secret' }), {
        status: 200,
      });
    return new Response(JSON.stringify({ id: 'google-event-1' }), {
      status: 200,
    });
  };
  const provider = new GoogleCalendarProvider(
    fetcher,
    {
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'refresh',
    },
    1000,
  );
  const result = await provider.createEvent(
    { calendarId: 'clinic@example.com', credentialsReference: 'DEFAULT' },
    {
      appointmentId: randomUUID(),
      title: 'Consulta - Cardiologia',
      location: 'Unidade Centro — Rua 1',
      startAt: '2035-01-01T12:00:00.000Z',
      endAt: '2035-01-01T13:00:00.000Z',
      timezone: 'America/Sao_Paulo',
    },
  );
  assert.equal(result.eventId, 'google-event-1');
  const event = JSON.parse(String(requests[1]?.init?.body));
  assert.deepEqual(Object.keys(event).sort(), [
    'end',
    'extendedProperties',
    'guestsCanInviteOthers',
    'guestsCanModify',
    'guestsCanSeeOtherGuests',
    'location',
    'start',
    'summary',
  ]);
  assert.equal(event.attendees, undefined);
  assert.equal(JSON.stringify(event).includes('patient'), false);
  assert.match(requests[1]!.url, /clinic%40example\.com\/events$/);
});

test('Google Calendar classifica rate limit como retry e não expõe resposta externa', async () => {
  const provider = new GoogleCalendarProvider(
    async (input) =>
      String(input).includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 'token' }), {
            status: 200,
          })
        : new Response('segredo externo', { status: 429 }),
    {
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'refresh',
    },
  );
  await assert.rejects(
    provider.testConnection({
      calendarId: 'id',
      credentialsReference: 'DEFAULT',
    }),
    (error: unknown) => {
      assert.ok(error instanceof CalendarProviderError);
      assert.equal(error.code, 'GOOGLE_HTTP_429');
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes('segredo'), false);
      return true;
    },
  );
});

test('credenciais e payload de calendário são estritos e job id é determinístico', () => {
  assert.deepEqual(
    googleCalendarCredentials('CLINIC_A', {
      GOOGLE_CLIENT_ID_CLINIC_A: 'id',
      GOOGLE_CLIENT_SECRET_CLINIC_A: 'secret',
      GOOGLE_REFRESH_TOKEN_CLINIC_A: 'refresh',
    }),
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
  );
  assert.throws(() => googleCalendarCredentials('../BAD', {}));
  const payload = {
    tenantId: randomUUID(),
    appointmentId: randomUUID(),
    revision: 2,
  };
  assert.deepEqual(parseCalendarSyncPayload(payload), payload);
  assert.equal(calendarSyncJobId(payload), calendarSyncJobId(payload));
  assert.throws(() =>
    parseCalendarSyncPayload({
      ...payload,
      tenantId: randomUUID(),
      calendarId: 'malicioso',
    }),
  );
  assert.equal(calendarReconciliationHorizon(undefined), 180);
  assert.throws(() => calendarReconciliationHorizon('0'));
});
