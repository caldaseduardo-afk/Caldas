import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const tones = [
  'PROFESSIONAL',
  'FRIENDLY',
  'CONCISE',
  'WARM',
  'FORMAL',
  'CUSTOM',
] as const;
export const capabilities = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'KNOWLEDGE',
  'HANDOFF',
] as const;
export const contentTopics = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'CLINIC_INFORMATION',
  'INSURANCE_INFORMATION',
  'PAYMENT_INFORMATION',
  'APPOINTMENT_PREPARATION',
] as const;
const dangerous =
  /(?:execute\s+sql|run[_ ]?sql|ignore\s+(?:tenant|authorization|autoriza[cç][aã]o)|use\s+any\s+tenant|n[aã]o\s+(?:fa[cç]a|fazer)\s+handoff\s+cl[ií]nico|openai[_-]?api[_-]?key|\bsk-[a-z0-9_-]+)/i;
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !dangerous.test(v),
      'Instrução incompatível com as regras da plataforma.',
    );
const fields = {
  assistantName: safeText(80),
  tone: z.enum(tones),
  customTone: safeText(500).nullable().optional(),
  greeting: safeText(500),
  systemInstructions: safeText(4000),
  allowedContent: z.array(z.enum(contentTopics)).min(1).max(7),
  enabledCapabilities: z.array(z.enum(capabilities)).min(1).max(5),
  knowledgeEnabled: z.boolean(),
  handoffPaymentNegotiation: z.boolean(),
  handoffKnowledgeMiss: z.boolean(),
  model: z.string().trim().min(1).max(128),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxOutputTokens: z.number().int().min(64).max(4096),
  confidenceThreshold: z.number().min(0).max(1),
};
const customTone = (v: { tone?: string; customTone?: string | null }) =>
  v.tone === undefined || v.tone === 'CUSTOM'
    ? v.tone === undefined || !!v.customTone
    : !v.customTone;
export const createVersionSchema = z
  .strictObject({ ...fields, basedOnVersionId: z.uuid().optional() })
  .refine(customTone, {
    path: ['customTone'],
    message: 'Tom customizado inválido.',
  });
export const updateVersionSchema = z
  .strictObject({
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    ...z.strictObject(fields).partial().shape,
  })
  .refine(customTone, {
    path: ['customTone'],
    message: 'Tom customizado inválido.',
  });
export const concurrencySchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});
export const cloneSchema = z.strictObject({
  expectedConfigurationUpdatedAt: z.iso.datetime({ offset: true }),
});
export const simulateSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
});
export const compareSchema = z.strictObject({ from: z.uuid(), to: z.uuid() });
export function parseAIConfigDto<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    );
  return parsed.data;
}
export type CreateVersionDto = z.infer<typeof createVersionSchema>;
export type UpdateVersionDto = z.infer<typeof updateVersionSchema>;
export type AICapabilityName = (typeof capabilities)[number];
