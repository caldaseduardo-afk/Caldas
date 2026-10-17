import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarIntegrationDto } from '../src/calendar-integrations/calendar-integration.dto';
import { CalendarIntegrationsService } from '../src/calendar-integrations/calendar-integrations.service';
import type { CalendarProvider } from '@atendente/domain';

test('DTO de calendário aceita apenas configuração administrativa permitida', () => {
  assert.deepEqual(
    calendarIntegrationDto({
      calendarId: 'clinic@example.com',
      credentialsReference: 'CLINIC_A',
    }),
    {
      calendarId: 'clinic@example.com',
      credentialsReference: 'CLINIC_A',
      status: 'ACTIVE',
    },
  );
  assert.throws(() =>
    calendarIntegrationDto({
      calendarId: 'id',
      credentialsReference: '../secret',
    }),
  );
  assert.throws(() =>
    calendarIntegrationDto({
      calendarId: 'id',
      credentialsReference: 'DEFAULT',
      tenantId: 'malicioso',
    }),
  );
});

test('serviço usa CalendarProvider injetado e devolve status sem credencial', async () => {
  let tested = false;
  const provider: CalendarProvider = {
    async testConnection(context) {
      tested = context.credentialsReference === 'SECRET_REFERENCE';
    },
    async findEventByAppointment() {
      return null;
    },
    async createEvent() {
      return { eventId: 'id' };
    },
    async updateEvent() {
      return { eventId: 'id' };
    },
    async cancelEvent() {},
  };
  const publicRow = { id: 'integration', status: 'ACTIVE' };
  const repository = {
    async internal() {
      return {
        scope: { tenantId: 'tenant' },
        row: {
          id: 'integration',
          calendarId: 'calendar',
          credentialsReference: 'SECRET_REFERENCE',
        },
      };
    },
    async recordTest() {
      return publicRow;
    },
  };
  const service = new CalendarIntegrationsService(
    repository as never,
    provider,
  );
  assert.deepEqual(await service.testConnection(), publicRow);
  assert.equal(tested, true);
  assert.equal('credentialsReference' in publicRow, false);
});
