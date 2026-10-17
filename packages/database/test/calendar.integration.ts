import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type {
  CalendarEventInput,
  CalendarProvider,
  CalendarProviderContext,
} from '@atendente/domain';
import {
  createCalendarSyncQueue,
  createCalendarSyncWorker,
  createDatabaseClient,
  dispatchCalendarSync,
  processCalendarSync,
  recordCalendarSyncIntent,
} from '../src';
import {
  DEVELOPMENT_TENANT_ID,
  DEVELOPMENT_UNIT_ID,
} from '../src/development-seed';

const connectionString = process.env.TEST_DATABASE_URL!;
const redis = process.env.TEST_REDIS_URL!;

class FakeCalendar implements CalendarProvider {
  created: CalendarEventInput[] = [];
  updated: CalendarEventInput[] = [];
  cancelled: string[] = [];
  found = new Map<string, string>();
  async testConnection() {}
  async findEventByAppointment(
    _context: CalendarProviderContext,
    appointmentId: string,
  ) {
    const eventId = this.found.get(appointmentId);
    return eventId ? { eventId } : null;
  }
  async createEvent(
    _context: CalendarProviderContext,
    input: CalendarEventInput,
  ) {
    this.created.push(input);
    const eventId = `created-${input.appointmentId}`;
    this.found.set(input.appointmentId, eventId);
    return { eventId };
  }
  async updateEvent(
    _context: CalendarProviderContext,
    eventId: string,
    input: CalendarEventInput,
  ) {
    this.updated.push(input);
    return { eventId };
  }
  async cancelEvent(_context: CalendarProviderContext, eventId: string) {
    this.cancelled.push(eventId);
  }
}

async function fixture() {
  const client = createDatabaseClient(connectionString);
  const suffix = randomUUID();
  const tenant = await client.tenant.findUniqueOrThrow({
    where: { id: DEVELOPMENT_TENANT_ID },
  });
  const unit = await client.unit.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: DEVELOPMENT_TENANT_ID,
        id: DEVELOPMENT_UNIT_ID,
      },
    },
  });
  const patient = await client.patient.create({
    data: {
      tenantId: tenant.id,
      name: 'Dado não enviado',
      birthDate: new Date('1990-01-01'),
    },
  });
  const specialty = await client.specialty.create({
    data: { tenantId: tenant.id, name: `Cardiologia ${suffix}` },
  });
  const service = await client.service.create({
    data: {
      tenantId: tenant.id,
      specialtyId: specialty.id,
      name: 'Consulta cardíaca',
      durationMinutes: 60,
    },
  });
  const provider = await client.provider.create({
    data: {
      tenantId: tenant.id,
      name: 'Profissional',
      professionalType: 'DOCTOR',
    },
  });
  await client.providerService.create({
    data: {
      tenantId: tenant.id,
      providerId: provider.id,
      serviceId: service.id,
    },
  });
  await client.providerUnit.create({
    data: { tenantId: tenant.id, providerId: provider.id, unitId: unit.id },
  });
  await client.calendarIntegration.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      calendarId: 'shared@example.com',
      credentialsReference: 'DEFAULT',
    },
    update: { status: 'ACTIVE' },
  });
  const appointment = await client.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: patient.id,
      serviceId: service.id,
      providerId: provider.id,
      unitId: unit.id,
      createdByType: 'SYSTEM',
      startAt: new Date('2035-06-01T12:00:00Z'),
      endAt: new Date('2035-06-01T13:00:00Z'),
      occupiedStartAt: new Date('2035-06-01T12:00:00Z'),
      occupiedEndAt: new Date('2035-06-01T13:00:00Z'),
      calendarProvider: 'GOOGLE_CALENDAR',
      syncStatus: 'PENDING',
      calendarSyncRevision: 1,
    },
  });
  await client.$transaction((tx) => recordCalendarSyncIntent(tx, appointment));
  return { client, tenant, appointment };
}

test('calendar sync cria, repete sem duplicar e cancela preservando a consulta interna', async () => {
  const { client, tenant, appointment } = await fixture();
  const calendar = new FakeCalendar();
  try {
    const payload = {
      tenantId: tenant.id,
      appointmentId: appointment.id,
      revision: 1,
    };
    assert.equal(
      (await processCalendarSync(client, calendar, payload)).outcome,
      'SYNCED',
    );
    assert.equal(
      (await processCalendarSync(client, calendar, payload)).outcome,
      'SKIPPED',
    );
    assert.equal(calendar.created.length, 1);
    assert.equal(
      JSON.stringify(calendar.created[0]).includes('Dado não enviado'),
      false,
    );
    const synced = await client.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
    });
    assert.equal(synced.syncStatus, 'SYNCED');
    assert.ok(synced.externalEventId);
    const changed = await client.appointment.update({
      where: { id: appointment.id },
      data: {
        startAt: new Date('2035-06-01T14:00:00Z'),
        endAt: new Date('2035-06-01T15:00:00Z'),
        occupiedStartAt: new Date('2035-06-01T14:00:00Z'),
        occupiedEndAt: new Date('2035-06-01T15:00:00Z'),
        syncStatus: 'PENDING',
        calendarSyncRevision: 2,
      },
    });
    await client.$transaction((tx) => recordCalendarSyncIntent(tx, changed));
    assert.equal(
      (await processCalendarSync(client, calendar, { ...payload, revision: 2 }))
        .outcome,
      'SYNCED',
    );
    assert.equal(calendar.updated.length, 1);
    assert.equal(calendar.updated[0]?.startAt, '2035-06-01T14:00:00.000Z');
    const cancelled = await client.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        syncStatus: 'PENDING',
        calendarSyncRevision: 3,
      },
    });
    await client.$transaction((tx) => recordCalendarSyncIntent(tx, cancelled));
    assert.equal(
      (await processCalendarSync(client, calendar, { ...payload, revision: 3 }))
        .outcome,
      'SYNCED',
    );
    assert.deepEqual(calendar.cancelled, [synced.externalEventId]);
    assert.equal(
      (
        await client.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        })
      ).status,
      'CANCELLED',
    );
  } finally {
    await client.$disconnect();
  }
});

test('calendar sync recupera evento criado antes do commit e rejeita contexto cross-tenant', async () => {
  const { client, tenant, appointment } = await fixture();
  const calendar = new FakeCalendar();
  calendar.found.set(appointment.id, 'event-after-crash');
  try {
    const result = await processCalendarSync(client, calendar, {
      tenantId: tenant.id,
      appointmentId: appointment.id,
      revision: 1,
    });
    assert.equal(result.outcome, 'SYNCED');
    assert.equal(calendar.created.length, 0);
    assert.equal(
      (
        await client.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        })
      ).externalEventId,
      'event-after-crash',
    );
    assert.equal(
      (
        await processCalendarSync(client, calendar, {
          tenantId: randomUUID(),
          appointmentId: appointment.id,
          revision: 1,
        })
      ).outcome,
      'SKIPPED',
    );
  } finally {
    await client.$disconnect();
  }
});

test('BullMQ reconcilia criação, alteração e cancelamento sem duplicar evento', async () => {
  const { client, appointment } = await fixture();
  const calendar = new FakeCalendar();
  const queue = createCalendarSyncQueue(redis);
  const worker = createCalendarSyncWorker(client, redis, calendar, 2);
  const waitFor = async (revision: number) => {
    for (let count = 0; count < 100; count++) {
      const row = await client.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      if (row.calendarSyncRevision === revision && row.syncStatus === 'SYNCED')
        return row;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Sincronização BullMQ não concluiu.');
  };
  try {
    await queue.obliterate({ force: true });
    const start = new Date(Date.now() + 7 * 86_400_000);
    await client.appointment.update({
      where: { id: appointment.id },
      data: {
        startAt: start,
        endAt: new Date(+start + 3_600_000),
        occupiedStartAt: start,
        occupiedEndAt: new Date(+start + 3_600_000),
      },
    });
    await Promise.all([
      dispatchCalendarSync(client, queue, 30),
      dispatchCalendarSync(client, queue, 30),
    ]);
    await waitFor(1);
    assert.equal(calendar.created.length, 1);

    const changed = await client.appointment.update({
      where: { id: appointment.id },
      data: {
        startAt: new Date(+start + 3_600_000),
        endAt: new Date(+start + 7_200_000),
        occupiedStartAt: new Date(+start + 3_600_000),
        occupiedEndAt: new Date(+start + 7_200_000),
        syncStatus: 'PENDING',
        calendarSyncRevision: 2,
      },
    });
    await client.$transaction((tx) => recordCalendarSyncIntent(tx, changed));
    await dispatchCalendarSync(client, queue, 30);
    await waitFor(2);
    assert.equal(calendar.updated.length, 1);

    const cancelled = await client.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        syncStatus: 'PENDING',
        calendarSyncRevision: 3,
      },
    });
    await client.$transaction((tx) => recordCalendarSyncIntent(tx, cancelled));
    await dispatchCalendarSync(client, queue, 30);
    await waitFor(3);
    assert.equal(calendar.cancelled.length, 1);
  } finally {
    await worker.close();
    await queue.close();
    await client.$disconnect();
  }
});
