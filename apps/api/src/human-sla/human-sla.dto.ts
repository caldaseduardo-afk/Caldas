import { BadRequestException } from '@nestjs/common';
import { validateHumanSlaRule, type HumanSlaConfig } from '@atendente/domain';
import { fields } from '../configuration/dto';
import { receiptDto } from '../conversations/conversation.dto';
const keys = [
  'firstAlertMinutes',
  'secondAlertMinutes',
  'externalAlertMinutes',
  'internalAlertEnabled',
  'externalAlertEnabled',
  'active',
] as const;
export function humanSlaDto(
  body: unknown,
  partial = false,
): Partial<HumanSlaConfig> {
  const input = fields(body, keys);
  for (const key of keys) {
    if (!(key in input)) {
      if (!partial)
        throw new BadRequestException('Campos de SLA obrigatórios.');
      continue;
    }
    const v = input[key];
    if (key.endsWith('Minutes')) {
      if (key === 'externalAlertMinutes' && v === null) continue;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 525600)
        throw new BadRequestException('Minutos SLA inválidos.');
    } else if (typeof v !== 'boolean')
      throw new BadRequestException('Flag SLA inválida.');
  }
  if (!partial) validateSla(input as unknown as HumanSlaConfig);
  return input as Partial<HumanSlaConfig>;
}
export function validateSla(rule: HumanSlaConfig) {
  try {
    validateHumanSlaRule(rule);
  } catch {
    throw new BadRequestException('Configuração SLA inválida.');
  }
}
export function previewDate(body: unknown) {
  const input = fields(body, ['requestedAt']);
  return receiptDto({ kind: 'READ', at: input.requestedAt }).at;
}
