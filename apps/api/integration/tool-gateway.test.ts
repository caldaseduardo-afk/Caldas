import { ToolHandlers } from '../src/tools/tool.handlers';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import { createDatabaseClient } from '@atendente/database';
import { ToolsModule } from '../src/tools/tools.module';
import { ToolGateway } from '../src/tools/tool-gateway.service';
import type { ToolName } from '../src/tools/tool.schemas';
import type { ToolResult } from '../src/tools/tool.errors';
import { DatabaseService } from '../src/auth/database.service';
import {
  weekdays,
  civilDate,
  localTime,
} from '../src/availability/availability.dto';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
const id = randomUUID;
function data<T>(result: ToolResult): T {
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data as T;
}
interface Hold {
  holdId: string;
  startAt: string;
  endAt: string;
  status: string;
}
interface Appointment {
  appointmentId: string;
  status: string;
  startAt: string;
}

test('Tool Gateway PostgreSQL: schemas, contato/paciente, scheduling, ações, auditoria e idempotência', async (t) => {
  const client = createDatabaseClient(connection);
  const module = await Test.createTestingModule({ imports: [ToolsModule] })
    .overrideProvider(DatabaseService)
    .useValue({ client })
    .compile();
  async function fixture() {
    const tenant = await client.tenant.create({
      data: { name: 'Tools', status: 'ACTIVE', timezone: 'UTC' },
    });
    const user = await client.user.create({
      data: {
        name: 'Executor',
        email: `${id()}@tools.test`,
        passwordHash: 'not-used',
        memberships: { create: { tenantId: tenant.id, role: 'AGENT' } },
      },
    });
    const session = await client.authSession.create({
      data: {
        userId: user.id,
        activeTenantId: tenant.id,
        tokenHash: id().replaceAll('-', '').repeat(2),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const contact = await client.contact.create({
      data: { tenantId: tenant.id, displayName: 'Contato token=PRIVATE' },
    });
    const patient = await client.patient.create({
      data: {
        tenantId: tenant.id,
        name: 'Paciente',
        birthDate: civilDate('2000-01-01'),
        document: '12345678901',
        notes: 'CLINICAL_PRIVATE',
      },
    });
    const link = await client.contactPatient.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        patientId: patient.id,
        relationshipType: 'SELF',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'SCHEDULING_ONLY',
        authorizedAt: new Date(),
        authorizedBy: user.id,
      },
    });
    const conversation = await client.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        activePatientId: patient.id,
        channel: 'WHATSAPP',
      },
    });
    const provider = await client.provider.create({
      data: {
        tenantId: tenant.id,
        name: 'Profissional',
        professionalType: 'DOCTOR',
      },
    });
    const unit = await client.unit.create({
      data: {
        tenantId: tenant.id,
        name: 'Unidade',
        address: 'Privado',
        timezoneOverride: 'America/Sao_Paulo',
      },
    });
    const specialty = await client.specialty.create({
      data: { tenantId: tenant.id, name: 'Área' },
    });
    const service = await client.service.create({
      data: {
        tenantId: tenant.id,
        specialtyId: specialty.id,
        name: 'Consulta',
        durationMinutes: 30,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 10,
      },
    });
    await client.providerService.create({
      data: {
        tenantId: tenant.id,
        providerId: provider.id,
        serviceId: service.id,
        durationOverrideMinutes: 40,
      },
    });
    await client.providerUnit.create({
      data: { tenantId: tenant.id, providerId: provider.id, unitId: unit.id },
    });
    for (const weekday of weekdays)
      await client.availabilityRule.create({
        data: {
          tenantId: tenant.id,
          providerId: provider.id,
          unitId: unit.id,
          weekday,
          startTime: localTime('07:00'),
          endTime: localTime('20:00'),
          validFrom: civilDate('2035-01-01'),
          validUntil: civilDate('2035-12-31'),
        },
      });
    const contextId = ContextIdFactory.create();
    module.registerRequestByContextId(
      {
        identity: { id: user.id, email: user.email, name: user.name },
        activeTenantId: tenant.id,
        sessionId: session.id,
      },
      contextId,
    );
    const gateway = await module.resolve(ToolGateway, contextId);
    const handlers = await module.resolve(ToolHandlers, contextId);
    const slot = (day: number, hour = 12) => ({
      serviceId: service.id,
      providerId: provider.id,
      unitId: unit.id,
      startAt: `2035-01-${String(day).padStart(2, '0')}T${hour}:00:00Z`,
    });
    return {
      tenant,
      user,
      session,
      contact,
      patient,
      link,
      conversation,
      provider,
      unit,
      specialty,
      service,
      gateway,
      handlers,
      slot,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function run(
    f: Fixture,
    name: ToolName,
    args: Record<string, unknown> = {},
    callId = id(),
    approve = true,
  ) {
    const approvalName =
      name === 'confirm_appointment' ||
      name === 'cancel_appointment' ||
      name === 'reschedule_appointment'
        ? name
        : undefined;
    const turn = await f.gateway.beginTurn({
      conversationId: f.conversation.id,
      actorType: 'AI',
      approvedMutations:
        approve && approvalName
          ? [{ name: approvalName, arguments: args }]
          : [],
    });
    return f.gateway.executeTool({ name, arguments: args, callId }, turn);
  }
  async function book(f: Fixture, day: number) {
    const hold = data<Hold>(await run(f, 'create_hold', f.slot(day)));
    return data<Appointment>(
      await run(f, 'confirm_appointment', { holdId: hold.holdId }),
    );
  }
  try {
    const a = await fixture(),
      b = await fixture();
    await t.test(
      'get_contact_context minimiza dados e SCHEDULING_ONLY não ganha leitura clínica',
      async () => {
        const result = await run(a, 'get_contact_context');
        const text = JSON.stringify(result);
        assert(!text.includes('PRIVATE'));
        assert(!text.includes('birthDate'));
        assert(!text.includes('document'));
        assert(!text.includes('tenantId'));
        const context = data<{
          patients: { patientId: string; authorizationLevel: string }[];
        }>(result);
        assert.deepEqual(
          context.patients.map((v) => v.patientId),
          [a.patient.id],
        );
        assert.equal(context.patients[0].authorizationLevel, 'SCHEDULING_ONLY');
      },
    );
    await t.test(
      'catálogo ativo do tenant funciona para AGENT sem service.manage e omite preço',
      async () => {
        await client.specialty.create({
          data: { tenantId: a.tenant.id, name: 'Inativa', active: false },
        });
        await client.service.create({
          data: {
            tenantId: a.tenant.id,
            specialtyId: a.specialty.id,
            name: 'Inativo',
            durationMinutes: 10,
            active: false,
          },
        });
        const areas = data<{ id: string }[]>(await run(a, 'list_specialties'));
        assert.deepEqual(
          areas.map((x) => x.id),
          [a.specialty.id],
        );
        const services = data<{ id: string }[]>(
          await run(a, 'list_services', { specialtyId: a.specialty.id }),
        );
        assert.deepEqual(
          services.map((x) => x.id),
          [a.service.id],
        );
        assert(!JSON.stringify(services).includes('price'));
        assert.equal(
          (await run(a, 'list_services', { specialtyId: b.specialty.id })).error
            ?.code,
          'RESOURCE_NOT_FOUND',
        );
      },
    );
    await t.test(
      'schemas rejeitam tenant, patient e assignedUserId em argumentos',
      async () => {
        assert.equal(
          (await run(a, 'create_hold', { ...a.slot(2), tenantId: b.tenant.id }))
            .error?.code,
          'INVALID_ARGUMENTS',
        );
        assert.equal(
          (
            await run(a, 'create_hold', {
              ...a.slot(2),
              patientId: b.patient.id,
            })
          ).error?.code,
          'INVALID_ARGUMENTS',
        );
        assert.equal(
          (await run(a, 'get_contact_context', { contactId: b.contact.id }))
            .error?.code,
          'INVALID_ARGUMENTS',
        );
        assert.equal(
          (
            await run(a, 'transfer_to_human', {
              reason: 'OTHER',
              assignedUserId: a.user.id,
            })
          ).error?.code,
          'INVALID_ARGUMENTS',
        );
      },
    );
    await t.test(
      'Conversation cross-tenant e contexto opaco forjado não autorizam',
      async () => {
        await assert.rejects(
          a.gateway.beginTurn({
            conversationId: b.conversation.id,
            actorType: 'AI',
          }),
        );
        assert.equal(
          (
            await a.gateway.executeTool(
              { name: 'list_services', arguments: {}, callId: id() },
              { id: id() },
            )
          ).error?.code,
          'UNAUTHORIZED',
        );
        await assert.rejects(
          client.conversation.update({
            where: { id: a.conversation.id },
            data: { activePatientId: b.patient.id },
          }),
        );
      },
    );
    await t.test(
      'Provider, Unit e Service alheios não criam HOLD mesmo com UUID conhecido',
      async () => {
        for (const patch of [
          { providerId: b.provider.id },
          { unitId: b.unit.id },
          { serviceId: b.service.id },
        ]) {
          const result = await run(a, 'create_hold', {
            ...a.slot(2),
            ...patch,
          });
          assert.equal(result.error?.code, 'RESOURCE_NOT_FOUND');
        }
        assert.equal(
          await client.appointmentHold.count({
            where: { tenantId: a.tenant.id },
          }),
          0,
        );
      },
    );
    await t.test(
      'REVOKED, NO_ACCESS e DECLARED bloqueiam; restauração não amplia FULL implicitamente',
      async () => {
        const restore = {
          active: true,
          relationshipStatus: 'VERIFIED' as const,
          authorizationLevel: 'SCHEDULING_ONLY' as const,
          revokedAt: null,
          revokedBy: null,
        };
        for (const patch of [
          { authorizationLevel: 'NO_ACCESS' as const },
          { relationshipStatus: 'DECLARED' as const },
          {
            relationshipStatus: 'REVOKED' as const,
            authorizationLevel: 'NO_ACCESS' as const,
            active: false,
            revokedAt: new Date(),
            revokedBy: a.user.id,
          },
        ]) {
          await client.contactPatient.update({
            where: { id: a.link.id },
            data: patch,
          });
          assert.equal(
            (await run(a, 'create_hold', a.slot(3))).error?.code,
            'INVALID_RELATIONSHIP',
          );
          await client.contactPatient.update({
            where: { id: a.link.id },
            data: restore,
          });
        }
      },
    );
    await t.test(
      'busca real respeita timezone, duração override, buffers e BLOCK',
      async () => {
        await client.scheduleException.create({
          data: {
            tenantId: a.tenant.id,
            providerId: a.provider.id,
            unitId: a.unit.id,
            date: civilDate('2035-01-08'),
            type: 'BLOCK',
            startTime: localTime('08:00'),
            endTime: localTime('09:00'),
          },
        });
        const slots = data<
          { startAt: string; endAt: string; timezone: string }[]
        >(
          await run(a, 'search_available_slots', {
            serviceId: a.service.id,
            startAt: '2035-01-08T10:00:00Z',
            endAt: '2035-01-08T16:00:00Z',
            limit: 20,
          }),
        );
        assert(slots.length);
        assert(slots.every((s) => s.timezone === 'America/Sao_Paulo'));
        assert(
          slots.every(
            (s) => +new Date(s.endAt) - +new Date(s.startAt) === 40 * 60000,
          ),
        );
        assert(!slots.some((s) => new Date(s.startAt).getUTCHours() === 11));
        assert(!slots.some((s) => s.startAt === '2035-01-08T10:00:00.000Z'));
      },
    );
    await t.test(
      'busca respeita HOLD e consulta, criação revalida resultado obsoleto',
      async () => {
        const hold = data<Hold>(await run(a, 'create_hold', a.slot(9)));
        const query = {
          serviceId: a.service.id,
          startAt: '2035-01-09T11:00:00Z',
          endAt: '2035-01-09T15:00:00Z',
        };
        const available = data<{ startAt: string }[]>(
          await run(a, 'search_available_slots', query),
        );
        assert(!available.some((s) => s.startAt === hold.startAt));
        assert.equal(
          (await run(a, 'create_hold', a.slot(9))).error?.code,
          'SLOT_UNAVAILABLE',
        );
        data(await run(a, 'confirm_appointment', { holdId: hold.holdId }));
        const availableAfter = data<{ startAt: string }[]>(
          await run(a, 'search_available_slots', query),
        );
        assert(!availableAfter.some((s) => s.startAt === hold.startAt));
      },
    );
    await t.test(
      'concorrência de HOLD tem um vencedor; mesmo callId não duplica',
      async () => {
        const results = await Promise.all([
          run(a, 'create_hold', a.slot(10)),
          run(a, 'create_hold', a.slot(10)),
        ]);
        assert.equal(results.filter((r) => r.success).length, 1);
        const callId = id();
        const repeated = await Promise.all([
          run(a, 'create_hold', a.slot(11), callId),
          run(a, 'create_hold', a.slot(11), callId),
        ]);
        const success = repeated.find((r) => r.success)!;
        assert(success);
        assert.deepEqual(
          await run(a, 'create_hold', a.slot(11), callId),
          success,
        );
        const row = await client.toolExecution.findFirstOrThrow({
          where: { tenantId: a.tenant.id, callId },
        });
        assert.equal(
          await client.appointmentHold.count({ where: { requestId: row.id } }),
          1,
        );
      },
    );
    await t.test(
      'revogação entre admissão e escrita é bloqueada pela transação de domínio',
      async (sub) => {
        const original = a.handlers.execute.bind(a.handlers);
        sub.mock.method(
          a.handlers,
          'execute',
          async (...args: Parameters<ToolHandlers['execute']>) => {
            await client.contactPatient.update({
              where: { id: a.link.id },
              data: { authorizationLevel: 'NO_ACCESS' },
            });
            return original(...args);
          },
        );
        try {
          const result = await run(a, 'create_hold', a.slot(17));
          assert.equal(result.error?.code, 'INVALID_RELATIONSHIP');
          assert.equal(
            await client.appointmentHold.count({
              where: {
                tenantId: a.tenant.id,
                startAt: new Date(a.slot(17).startAt),
              },
            }),
            0,
          );
        } finally {
          await client.contactPatient.update({
            where: { id: a.link.id },
            data: { authorizationLevel: 'SCHEDULING_ONLY' },
          });
        }
      },
    );
    await t.test(
      'handoff humano entre admissão e escrita bloqueia mutação AI',
      async (sub) => {
        const original = a.handlers.execute.bind(a.handlers);
        sub.mock.method(
          a.handlers,
          'execute',
          async (...args: Parameters<ToolHandlers['execute']>) => {
            await client.conversation.update({
              where: { id: a.conversation.id },
              data: {
                status: 'HUMAN_ACTIVE',
                assignedUserId: a.user.id,
                assignedAt: new Date(),
              },
            });
            return original(...args);
          },
        );
        try {
          assert.equal(
            (await run(a, 'create_hold', a.slot(18))).error?.code,
            'FORBIDDEN',
          );
          assert.equal(
            await client.appointmentHold.count({
              where: {
                tenantId: a.tenant.id,
                startAt: new Date(a.slot(18).startAt),
              },
            }),
            0,
          );
        } finally {
          await client.conversation.update({
            where: { id: a.conversation.id },
            data: {
              status: 'AI_ACTIVE',
              assignedUserId: null,
              assignedAt: null,
            },
          });
        }
      },
    );
    await t.test(
      'timeout antes de escrever impede mutação tardia e não libera replay paralelo',
      async (sub) => {
        const original = a.handlers.execute.bind(a.handlers);
        const config = (
          a.gateway as unknown as { config: { limits: Record<string, number> } }
        ).config;
        const saved = config.limits;
        config.limits = { ...saved, toolTimeoutMs: 100 };
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        sub.mock.method(
          a.handlers,
          'execute',
          async (...args: Parameters<ToolHandlers['execute']>) => {
            try {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return await original(...args);
            } finally {
              finish();
            }
          },
        );
        const callId = id();
        try {
          assert.equal(
            (await run(a, 'create_hold', a.slot(19), callId)).error?.code,
            'TOOL_TIMEOUT',
          );
          assert.equal(
            (await run(a, 'create_hold', a.slot(19), callId)).error?.code,
            'CALL_IN_PROGRESS',
          );
          await finished;
          assert.equal(
            await client.appointmentHold.count({
              where: {
                tenantId: a.tenant.id,
                startAt: new Date(a.slot(19).startAt),
              },
            }),
            0,
          );
        } finally {
          config.limits = saved;
        }
      },
    );
    const appointmentA = await book(a, 12),
      appointmentB = await book(b, 12);
    await t.test(
      'get/cancel consulta cross-tenant não revela existência; paciente diferente também bloqueia',
      async () => {
        const listed = data<Appointment[]>(
          await run(a, 'list_appointments', {
            startAt: '2035-01-12T00:00:00Z',
            endAt: '2035-01-13T00:00:00Z',
            limit: 5,
          }),
        );
        assert.deepEqual(
          listed.map((appointment) => appointment.appointmentId),
          [appointmentA.appointmentId],
        );
        assert(!JSON.stringify(listed).includes(appointmentB.appointmentId));
        for (const appointmentId of [appointmentB.appointmentId, id()]) {
          assert.equal(
            (await run(a, 'get_appointment', { appointmentId })).error?.code,
            'RESOURCE_NOT_FOUND',
          );
          assert.equal(
            (await run(a, 'cancel_appointment', { appointmentId })).error?.code,
            'RESOURCE_NOT_FOUND',
          );
        }
        const row = await client.appointment.findUniqueOrThrow({
          where: { id: appointmentB.appointmentId },
        });
        assert.equal(row.status, 'PENDING_CONFIRMATION');
        assert.equal(
          data<Appointment>(
            await run(a, 'get_appointment', {
              appointmentId: appointmentA.appointmentId,
            }),
          ).appointmentId,
          appointmentA.appointmentId,
        );
      },
    );
    await t.test(
      'paciente ativo não pode ser sobrescrito e UUID de outro paciente do tenant não autoriza',
      async () => {
        await assert.rejects(
          a.gateway.beginTurn({
            conversationId: a.conversation.id,
            actorType: 'AI',
            activePatientId: b.patient.id,
          } as never),
        );
        const other = await client.patient.create({
          data: {
            tenantId: a.tenant.id,
            name: 'Outro',
            birthDate: civilDate('2001-01-01'),
          },
        });
        await client.contactPatient.create({
          data: {
            tenantId: a.tenant.id,
            contactId: a.contact.id,
            patientId: other.id,
            relationshipType: 'OTHER',
            relationshipStatus: 'VERIFIED',
            authorizationLevel: 'SCHEDULING_ONLY',
            authorizedBy: a.user.id,
            authorizedAt: new Date(),
          },
        });
        await client.conversation.update({
          where: { id: a.conversation.id },
          data: { activePatientId: other.id },
        });
        try {
          assert.equal(
            (
              await run(a, 'get_appointment', {
                appointmentId: appointmentA.appointmentId,
              })
            ).error?.code,
            'RESOURCE_NOT_FOUND',
          );
        } finally {
          await client.conversation.update({
            where: { id: a.conversation.id },
            data: { activePatientId: a.patient.id },
          });
        }
      },
    );
    await t.test(
      'confirmar exige intenção confiável, preserva máquina de estados e replay',
      async () => {
        const args = { appointmentId: appointmentA.appointmentId };
        assert.equal(
          (await run(a, 'confirm_appointment', args, id(), false)).error?.code,
          'CONFIRMATION_REQUIRED',
        );
        const callId = id();
        const first = await run(a, 'confirm_appointment', args, callId);
        assert.equal(data<Appointment>(first).status, 'CONFIRMED');
        assert.deepEqual(
          await run(a, 'confirm_appointment', args, callId),
          first,
        );
        assert.equal(
          data<Appointment>(await run(a, 'confirm_appointment', args)).status,
          'CONFIRMED',
        );
      },
    );
    await t.test(
      'remarcação transacional mantém relação e não duplica no retry',
      async () => {
        const hold = data<Hold>(await run(a, 'create_hold', a.slot(13)));
        const args = {
            appointmentId: appointmentA.appointmentId,
            holdId: hold.holdId,
          },
          callId = id();
        const first = await run(a, 'reschedule_appointment', args, callId),
          next = data<Appointment>(first);
        assert.deepEqual(
          await run(a, 'reschedule_appointment', args, callId),
          first,
        );
        const old = await client.appointment.findUniqueOrThrow({
          where: { id: appointmentA.appointmentId },
        });
        assert.equal(old.status, 'RESCHEDULED');
        const row = await client.appointment.findUniqueOrThrow({
          where: { id: next.appointmentId },
        });
        assert.equal(row.previousAppointmentId, old.id);
        assert.equal(
          (await run(a, 'confirm_appointment', { appointmentId: old.id })).error
            ?.code,
          'INVALID_APPOINTMENT_STATE',
        );
      },
    );
    await t.test(
      'cancelamento preserva histórico; mesmo/diferente callId são consistentes',
      async () => {
        const appt = await book(a, 14);
        const args = {
            appointmentId: appt.appointmentId,
            reason: 'Solicitação',
          },
          callId = id();
        const first = await run(a, 'cancel_appointment', args, callId);
        assert.equal(data<Appointment>(first).status, 'CANCELLED');
        assert.deepEqual(
          await run(a, 'cancel_appointment', args, callId),
          first,
        );
        assert.equal(
          data<Appointment>(await run(a, 'cancel_appointment', args)).status,
          'CANCELLED',
        );
        assert.equal(
          await client.authEvent.count({
            where: {
              resourceId: appt.appointmentId,
              type: 'APPOINTMENT_CANCELLED',
            },
          }),
          1,
        );
      },
    );
    await t.test(
      'HOLD expirado e ranges/limits excessivos geram erros seguros',
      async () => {
        const hold = data<Hold>(await run(a, 'create_hold', a.slot(15)));
        await client.appointmentHold.update({
          where: { id: hold.holdId },
          data: { status: 'EXPIRED' },
        });
        assert.equal(
          (await run(a, 'confirm_appointment', { holdId: hold.holdId })).error
            ?.code,
          'HOLD_EXPIRED',
        );
        assert.equal(
          (
            await run(a, 'search_available_slots', {
              serviceId: a.service.id,
              startAt: '2035-01-01T10:00:00Z',
              endAt: '2035-12-01T10:00:00Z',
            })
          ).error?.code,
          'INVALID_ARGUMENTS',
        );
        assert.equal(
          (
            await run(a, 'search_available_slots', {
              serviceId: a.service.id,
              startAt: '2035-01-01T10:00:00Z',
              endAt: '2035-01-02T10:00:00Z',
              limit: 21,
            })
          ).error?.code,
          'INVALID_ARGUMENTS',
        );
      },
    );
    await t.test(
      'revogação de RBAC e SUPER_ADMIN não habilitado falham fechado',
      async () => {
        for (const role of ['DOCTOR', 'SUPER_ADMIN']) {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: a.user.id, tenantId: a.tenant.id },
            },
            data: { role },
          });
          await assert.rejects(
            a.gateway.beginTurn({
              conversationId: a.conversation.id,
              actorType: 'AI',
            }),
          );
        }
        await client.userTenant.update({
          where: {
            userId_tenantId: { userId: a.user.id, tenantId: a.tenant.id },
          },
          data: { role: 'AGENT' },
        });
      },
    );
    await t.test(
      'auditoria persiste sucesso e falha crítica sem argumentos/segredos',
      async () => {
        const rows = await client.toolExecution.findMany({
          where: { tenantId: a.tenant.id },
        });
        assert(rows.some((r) => r.status === 'SUCCESS'));
        assert(rows.some((r) => r.errorCode === 'INVALID_RELATIONSHIP'));
        assert(
          rows.every(
            (r) =>
              r.actorId === a.user.id &&
              r.actorType === 'AI' &&
              r.contactId === a.contact.id,
          ),
        );
        assert(!JSON.stringify(rows).includes('PRIVATE'));
        assert(!JSON.stringify(rows).includes('arguments'));
        assert(!JSON.stringify(rows).includes('Paciente'));
      },
    );
    await t.test('HUMAN_ACTIVE impede IA; USER exige ownership', async () => {
      await client.conversation.update({
        where: { id: a.conversation.id },
        data: {
          status: 'HUMAN_ACTIVE',
          assignedUserId: a.user.id,
          assignedAt: new Date(),
        },
      });
      assert.equal((await run(a, 'list_services')).error?.code, 'FORBIDDEN');
      const turn = await a.gateway.beginTurn({
        conversationId: a.conversation.id,
        actorType: 'USER',
      });
      assert(
        (
          await a.gateway.executeTool(
            { name: 'list_services', arguments: {}, callId: id() },
            turn,
          )
        ).success,
      );
      await client.conversation.update({
        where: { id: a.conversation.id },
        data: { status: 'AI_ACTIVE', assignedUserId: null, assignedAt: null },
      });
    });
    await t.test(
      'handoff registra motivo/SLA uma vez; retry permitido e cadeia AI interrompida',
      async () => {
        const callId = id(),
          args = { reason: 'USER_REQUESTED_HUMAN' };
        await client.contactPatient.update({
          where: { id: a.link.id },
          data: { authorizationLevel: 'NO_ACCESS' },
        });
        const first = await run(a, 'transfer_to_human', args, callId);
        assert.equal(data<{ status: string }>(first).status, 'NEEDS_HUMAN');
        assert.deepEqual(
          await run(a, 'transfer_to_human', args, callId),
          first,
        );
        const row = await client.conversation.findUniqueOrThrow({
          where: { id: a.conversation.id },
        });
        assert.equal(row.handoffReason, 'USER_REQUESTED_HUMAN');
        assert.equal(row.assignedUserId, null);
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: row.id, type: 'HUMAN_HANDOFF_REQUESTED' },
          }),
          1,
        );
        assert.equal((await run(a, 'list_services')).error?.code, 'FORBIDDEN');
      },
    );
    await t.test(
      'CLOSED/RESOLVED não permitem tool de atendimento',
      async () => {
        for (const status of ['RESOLVED', 'CLOSED'] as const) {
          await client.conversation.update({
            where: { id: b.conversation.id },
            data: { status, resolvedAt: new Date() },
          });
          assert.equal(
            (await run(b, 'list_services')).error?.code,
            'FORBIDDEN',
          );
        }
      },
    );
  } finally {
    await module.close();
    await client.$disconnect();
  }
});
