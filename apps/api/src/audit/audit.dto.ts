import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  AuditActorType,
  AuditSource,
  AuditResourceType,
  AuthEventType,
} from '@atendente/database';
const schema = z
  .strictObject({
    resourceType: z.enum(AuditResourceType).optional(),
    resourceId: z.uuid().optional(),
    action: z.enum(AuthEventType).optional(),
    actorType: z.enum(AuditActorType).optional(),
    actorUserId: z.uuid().optional(),
    source: z.enum(AuditSource).optional(),
    correlationId: z.uuid().optional(),
    dateFrom: z.iso.datetime({ offset: true }).optional(),
    dateTo: z.iso.datetime({ offset: true }).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (v) =>
      !v.dateFrom ||
      !v.dateTo ||
      Date.parse(v.dateFrom) <= Date.parse(v.dateTo),
  );
export function auditQuery(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Filtros inválidos.');
  return parsed.data;
}
