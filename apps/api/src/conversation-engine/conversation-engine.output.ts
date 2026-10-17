import { z } from 'zod';

export const conversationIntents = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'CONFIRMATION',
  'INFORMATION',
  'PAYMENT',
  'COMPLAINT',
  'CLINICAL_QUESTION',
  'OTHER',
] as const;

export const handoffReasons = [
  'USER_REQUESTED_HUMAN',
  'AI_LOW_CONFIDENCE',
  'PAYMENT_NEGOTIATION',
  'COMPLAINT',
  'CLINICAL_QUESTION',
  'AUTHORIZATION_PROBLEM',
  'SCHEDULING_CONFLICT',
  'SYSTEM_ERROR',
  'OTHER',
] as const;

export const schedulingActions = [
  'NONE',
  'START',
  'START_CANCELLATION',
  'START_RESCHEDULING',
  'SELECT_PATIENT',
  'LIST_APPOINTMENTS',
  'SELECT_APPOINTMENT',
  'SELECT_SERVICE',
  'SET_PREFERENCES',
  'SEARCH_SLOTS',
  'SELECT_SLOT',
  'CONFIRM',
  'CHANGE_SELECTION',
  'ABANDON',
] as const;

const schedulingCommandSchema = z.strictObject({
  action: z.enum(schedulingActions),
  patientId: z.uuid().nullable(),
  specialtyId: z.uuid().nullable(),
  serviceId: z.uuid().nullable(),
  providerId: z.uuid().nullable(),
  unitId: z.uuid().nullable(),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  preferredPeriod: z
    .enum(['MORNING', 'AFTERNOON', 'EVENING', 'ANY'])
    .nullable(),
  optionNumber: z.number().int().min(1).max(5).nullable(),
});

export const engineOutputSchema = z.strictObject({
  intent: z.enum(conversationIntents),
  confidence: z.number().min(0).max(1),
  response: z.string().trim().min(1).max(4000).nullable(),
  waitingForPatient: z.boolean(),
  handoffReason: z.enum(handoffReasons).nullable(),
  summary: z.string().trim().min(1).max(2000).nullable(),
  scheduling: schedulingCommandSchema.nullable().optional(),
  toolCalls: z
    .array(
      z.strictObject({
        name: z
          .string()
          .regex(/^[a-z_]+$/)
          .max(64),
        callId: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .max(100),
        arguments: z.record(z.string(), z.unknown()),
      }),
    )
    .max(8),
});

export type ConversationEngineOutput = z.infer<typeof engineOutputSchema>;

export const engineResponseFormat = {
  type: 'json_schema' as const,
  name: 'conversation_engine_turn',
  schema: z.toJSONSchema(engineOutputSchema) as Record<string, unknown>,
};

export function parseEngineOutput(content: string): ConversationEngineOutput {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('AI_INVALID_RESPONSE');
  }
  const parsed = engineOutputSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI_INVALID_RESPONSE');
  return parsed.data;
}
