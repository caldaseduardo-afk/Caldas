import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { dashboardQuery } from '../analytics/analytics.dto';
const schema = z
  .object({
    period: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    activeInPeriod: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(100).default(''),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    integrationStatus: z
      .enum(['ACTIVE', 'DEGRADED', 'ERROR', 'DISABLED'])
      .optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export function platformQuery(raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Filtros inválidos.');
  const { period, from, to, ...rest } = parsed.data;
  return { ...rest, ...dashboardQuery({ period, from, to }) };
}
export type PlatformQuery = ReturnType<typeof platformQuery>;
export function platformTenantId(raw: string) {
  const result = z.uuid().safeParse(raw);
  if (!result.success) throw new BadRequestException('Clínica inválida.');
  return result.data;
}
