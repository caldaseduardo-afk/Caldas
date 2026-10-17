import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const schema = z.strictObject({
  calendarId: z.string().trim().min(1).max(512),
  credentialsReference: z.string().regex(/^[A-Z0-9_]{1,96}$/),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
});

export type CalendarIntegrationDto = z.infer<typeof schema>;
export function calendarIntegrationDto(value: unknown): CalendarIntegrationDto {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues[0]?.message ?? 'Configuração inválida.',
    );
  return result.data;
}
