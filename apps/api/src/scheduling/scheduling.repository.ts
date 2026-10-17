import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { databaseNow } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import { checkOperationDeadline } from '../permissions/operation-boundary';
import {
  fitsStructuralWindows,
  localClock,
  overlaps,
} from '../holds/scheduling-conflict';
import { loadStructuralAvailability } from '../availability/availability.repository';
import {
  structuralWindows,
  type Window,
} from '../availability/availability.windows';
import { civilDate, timeText } from '../availability/availability.dto';
import type { SlotSearch } from './scheduling.service';
@Injectable()
export class SchedulingRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async search(input: SlotSearch, start: Date, end: Date, limit: number) {
    const permissions = ['appointment.view', 'unit.view'] as const;
    const scope = await this.authorization.requirePermissions(...permissions);
    const db = this.database.client;
    const where = {
      tenantId: scope.tenantId,
      tenant: authorizedTenantFilter(scope, permissions),
    };
    const service = await db.service.findFirst({
      where: {
        ...where,
        id: input.serviceId,
        active: true,
        specialty: { active: true },
      },
      select: {
        durationMinutes: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
      },
    });
    if (!service) throw new NotFoundException();
    const bindings = await db.providerUnit.findMany({
      where: {
        ...where,
        active: true,
        providerId: input.providerId,
        unitId: input.unitId,
        unit: { active: true },
        provider: {
          active: true,
          services: {
            some: {
              tenantId: scope.tenantId,
              serviceId: input.serviceId,
              active: true,
            },
          },
        },
      },
      select: {
        providerId: true,
        unitId: true,
        unit: { select: { timezoneOverride: true } },
        tenant: { select: { timezone: true } },
        provider: {
          select: {
            services: {
              where: {
                tenantId: scope.tenantId,
                serviceId: input.serviceId,
                active: true,
              },
              select: { durationOverrideMinutes: true },
            },
          },
        },
      },
      orderBy: [{ providerId: 'asc' }, { unitId: 'asc' }],
      take: 21,
    });
    if (bindings.length > 20)
      throw new BadRequestException('Restrinja profissional/unidade.');
    if (!bindings.length && (input.providerId || input.unitId))
      throw new NotFoundException();
    const now = await databaseNow(db);
    const candidates = [];
    for (const binding of bindings) {
      checkOperationDeadline();
      const range = {
        ...where,
        providerId: binding.providerId,
        unitId: binding.unitId,
        occupiedStartAt: {
          lt: new Date(+end + service.bufferAfterMinutes * 60000),
        },
        occupiedEndAt: {
          gt: new Date(+start - service.bufferBeforeMinutes * 60000),
        },
      };
      const appointments = await db.appointment.findMany({
        where: {
          ...range,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'] },
        },
        select: { occupiedStartAt: true, occupiedEndAt: true },
        take: 2001,
      });
      const holds = await db.appointmentHold.findMany({
        where: { ...range, status: 'ACTIVE', expiresAt: { gt: now } },
        select: { occupiedStartAt: true, occupiedEndAt: true },
        take: 2001,
      });
      if (appointments.length > 2000 || holds.length > 2000)
        throw new BadRequestException('Restrinja intervalo.');
      candidates.push({
        binding,
        timezone: binding.unit.timezoneOverride ?? binding.tenant.timezone,
        duration:
          binding.provider.services[0].durationOverrideMinutes ??
          service.durationMinutes,
        conflicts: [...appointments, ...holds].map((v) => ({
          start: v.occupiedStartAt,
          end: v.occupiedEndAt,
        })),
        windows: new Map<string, Window[]>(),
      });
    }
    const result: {
      serviceId: string;
      providerId: string;
      unitId: string;
      startAt: string;
      endAt: string;
      timezone: string;
    }[] = [];
    // Iterate real instants, never infer offsets from browser/local runtime timezone.
    for (let time = +start; time < +end; time += 15 * 60000) {
      checkOperationDeadline();
      if (time <= +now) continue;
      for (const candidate of candidates) {
        const occupiedStart = new Date(
          time - service.bufferBeforeMinutes * 60000,
        );
        const endAt = new Date(time + candidate.duration * 60000);
        const occupiedEnd = new Date(
          +endAt + service.bufferAfterMinutes * 60000,
        );
        if (
          +endAt > +end ||
          +occupiedEnd - +occupiedStart > 26 * 3600000 ||
          candidate.conflicts.some((c) =>
            overlaps(c, { start: occupiedStart, end: occupiedEnd }),
          )
        )
          continue;
        const day = localClock(occupiedStart, candidate.timezone).date;
        let windows = candidate.windows.get(day);
        if (!windows) {
          const structural = await loadStructuralAvailability(
            db,
            scope,
            permissions,
            candidate.binding.providerId,
            candidate.binding.unitId,
            civilDate(day),
          );
          windows = structuralWindows(
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
          candidate.windows.set(day, windows);
        }
        if (
          fitsStructuralWindows(
            occupiedStart,
            occupiedEnd,
            candidate.timezone,
            windows,
          )
        ) {
          result.push({
            serviceId: input.serviceId,
            providerId: candidate.binding.providerId,
            unitId: candidate.binding.unitId,
            startAt: new Date(time).toISOString(),
            endAt: endAt.toISOString(),
            timezone: candidate.timezone,
          });
          if (result.length >= limit) return result;
        }
      }
    }
    return result;
  }
}
