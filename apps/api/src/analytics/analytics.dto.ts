import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return (
      Number.isFinite(+d) &&
      d.toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-12-31'
    );
  });
const schema = z
  .object({
    period: z
      .enum([
        'TODAY',
        'LAST_7_DAYS',
        'LAST_30_DAYS',
        'THIS_MONTH',
        'LAST_MONTH',
        'CUSTOM',
      ])
      .default('LAST_30_DAYS'),
    from: date.optional(),
    to: date.optional(),
    unitId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    providerId: z.uuid().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.period === 'CUSTOM' ? !v.from || !v.to : v.from || v.to)
      ctx.addIssue({
        code: 'custom',
        message: 'Datas apenas para período personalizado.',
      });
    if (
      v.from &&
      v.to &&
      (v.from > v.to ||
        (Date.parse(v.to) - Date.parse(v.from)) / 86400000 >= 366)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Intervalo máximo de 366 dias.',
      });
  });
export type DashboardQuery = z.infer<typeof schema>;
export function dashboardQuery(raw: unknown): DashboardQuery {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new BadRequestException(
      'Filtros inválidos. Use datas válidas e até 366 dias.',
    );
  return parsed.data;
}
const options = z
  .object({
    kind: z.enum(['unit', 'service', 'provider']),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    search: z.string().trim().max(100).default(''),
  })
  .strict();
export function optionsQuery(raw: unknown) {
  const parsed = options.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Filtros inválidos.');
  return parsed.data;
}
