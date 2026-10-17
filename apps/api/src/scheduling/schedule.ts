import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  databaseNow,
  expireTenantHolds,
  type Prisma,
  type PermissionName,
} from '@atendente/database';
import type { TenantScope } from '../tenancy/tenant.context';
import { holdWhere } from '../holds/hold-access';
import type { CreateHoldDto } from '../holds/hold.dto';
import { loadStructuralAvailability } from '../availability/availability.repository';
import { civilDate, timeText } from '../availability/availability.dto';
import { structuralWindows } from '../availability/availability.windows';
import {
  fitsStructuralWindows,
  localClock,
} from '../holds/scheduling-conflict';
export async function lockResource(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  permissions: readonly PermissionName[],
  dto: { providerId: string; unitId: string },
) {
  const where = holdWhere(scope, permissions);
  const [binding] = await tx.providerUnit.updateManyAndReturn({
    where: { ...where, providerId: dto.providerId, unitId: dto.unitId },
    data: { updatedAt: new Date() },
    select: {
      active: true,
      provider: { select: { active: true } },
      unit: { select: { active: true, timezoneOverride: true } },
      tenant: { select: { timezone: true } },
    },
  });
  if (!binding) throw new NotFoundException('Recurso não encontrado.');
  const now = await databaseNow(tx);
  await expireTenantHolds(tx, scope.tenantId, now, dto);
  return { binding, now };
}
export async function validateSchedule(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  permissions: readonly PermissionName[],
  dto: Omit<CreateHoldDto, 'requestId'>,
  locked: Awaited<ReturnType<typeof lockResource>>,
) {
  const { binding, now } = locked;
  const where = holdWhere(scope, permissions);
  if (dto.startAt <= now)
    throw new BadRequestException('O atendimento deve iniciar no futuro.');
  if (!binding.active || !binding.provider.active || !binding.unit.active)
    throw new ConflictException('Recurso indisponível.');
  const patient = await tx.patient.findFirst({
    where: { id: dto.patientId, ...where },
    select: { id: true },
  });
  if (!patient) throw new NotFoundException('Recurso não encontrado.');
  if (
    dto.contactId &&
    !(await tx.contactPatient.findFirst({
      where: {
        ...where,
        patientId: dto.patientId,
        contactId: dto.contactId,
        active: true,
        relationshipStatus: 'VERIFIED',
        authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
        contact: { tenantId: scope.tenantId, status: 'ACTIVE' },
      },
      select: { id: true },
    }))
  )
    throw new NotFoundException('Recurso não encontrado.');
  const providerService = await tx.providerService.findFirst({
    where: {
      ...where,
      providerId: dto.providerId,
      serviceId: dto.serviceId,
      active: true,
      service: { tenantId: scope.tenantId, active: true },
    },
    select: {
      durationOverrideMinutes: true,
      service: {
        select: {
          durationMinutes: true,
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
        },
      },
    },
  });
  if (!providerService) throw new NotFoundException('Recurso não encontrado.');
  const service = providerService.service;
  const duration =
    providerService.durationOverrideMinutes ?? service.durationMinutes;
  const endAt = new Date(+dto.startAt + duration * 60000);
  if (dto.endAt && +dto.endAt !== +endAt)
    throw new BadRequestException('Fim incompatível com a duração do serviço.');
  const occupiedStartAt = new Date(
    +dto.startAt - service.bufferBeforeMinutes * 60000,
  );
  const occupiedEndAt = new Date(+endAt + service.bufferAfterMinutes * 60000);
  if (+occupiedEndAt - +occupiedStartAt > 26 * 3600000)
    throw new ConflictException('Ocupação excede uma data local.');
  const timezone = binding.unit.timezoneOverride ?? binding.tenant.timezone;
  const structural = await loadStructuralAvailability(
    tx,
    scope,
    permissions,
    dto.providerId,
    dto.unitId,
    civilDate(localClock(occupiedStartAt, timezone).date),
  );
  const windows = structuralWindows(
    structural.availabilityRules.map((r) => ({
      start: timeText(r.startTime),
      end: timeText(r.endTime),
    })),
    structural.scheduleExceptions.map((e) => ({
      type: e.type,
      startTime: e.startTime ? timeText(e.startTime) : null,
      endTime: e.endTime ? timeText(e.endTime) : null,
    })),
  );
  if (!fitsStructuralWindows(occupiedStartAt, occupiedEndAt, timezone, windows))
    throw new ConflictException('Período fora da disponibilidade.');

  return { endAt, occupiedStartAt, occupiedEndAt };
}

export async function assertNoConflict(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  permissions: readonly PermissionName[],
  slot: {
    providerId: string;
    unitId: string;
    occupiedStartAt: Date;
    occupiedEndAt: Date;
  },
  now: Date,
  excludeHoldId?: string,
) {
  const where = {
    ...holdWhere(scope, permissions),
    providerId: slot.providerId,
    unitId: slot.unitId,
    occupiedStartAt: { lt: slot.occupiedEndAt },
    occupiedEndAt: { gt: slot.occupiedStartAt },
  };
  const appointment = await tx.appointment.findFirst({
    where: {
      ...where,
      status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'] },
    },
    select: { id: true },
  });
  const hold = await tx.appointmentHold.findFirst({
    where: {
      ...where,
      status: 'ACTIVE',
      expiresAt: { gt: now },
      ...(excludeHoldId ? { id: { not: excludeHoldId } } : {}),
    },
    select: { id: true },
  });
  if (appointment || hold) throw new ConflictException('Período indisponível.');
}
