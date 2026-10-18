import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { isPlanCode } from '@atendente/domain';
import { validatePlanOverrides } from './plan-usage';

const schema = z
  .object({
    planCode: z.string().refine(isPlanCode).optional(),
    status: z.enum(['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED', 'CANCELLED']).optional(),
    graceUntil: z.string().datetime({ offset: true }).nullable().optional(),
    scheduledPlanCode: z.string().refine(isPlanCode).nullable().optional(),
    applyAt: z.enum(['NOW', 'NEXT_CYCLE']).default('NOW'),
    overrides: z.unknown().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'applyAt'), {
    message: 'Informe uma alteração de plano.',
  });

export function parseSubscriptionChange(raw: unknown) {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException('Alteração de plano inválida.');
  try {
    const overrides = result.data.overrides === undefined
      ? undefined
      : validatePlanOverrides(result.data.overrides);
    return {
      ...result.data,
      ...(result.data.graceUntil !== undefined
        ? { graceUntil: result.data.graceUntil ? new Date(result.data.graceUntil) : null }
        : {}),
      ...(overrides !== undefined ? { overrides } : {}),
    };
  } catch {
    throw new BadRequestException('Overrides do plano inválidos.');
  }
}

export type SubscriptionChange = ReturnType<typeof parseSubscriptionChange>;
