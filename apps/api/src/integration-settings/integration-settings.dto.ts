import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const schema = z.strictObject({
  openAiApiKey: z.string().min(20).max(512).optional(),
  whatsapp: z
    .strictObject({
      accessToken: z.string().min(20).max(4096).optional(),
      phoneNumberId: z.string().regex(/^[1-9]\d{4,31}$/),
      businessAccountId: z.string().regex(/^[1-9]\d{4,31}$/),
    })
    .optional(),
});

export type IntegrationSettingsInput = z.infer<typeof schema>;

export function integrationSettingsDto(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success || (!parsed.data.openAiApiKey && !parsed.data.whatsapp))
    throw new BadRequestException(
      parsed.success
        ? 'Informe ao menos uma credencial para salvar.'
        : (parsed.error.issues[0]?.message ?? 'Configuração inválida.'),
    );
  if (parsed.data.whatsapp && !parsed.data.whatsapp.accessToken)
    throw new BadRequestException('Informe o token de acesso do WhatsApp.');
  return parsed.data;
}
