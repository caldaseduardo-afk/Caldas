import { BadRequestException } from '@nestjs/common';

export function fields(
  body: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Dados inválidos.');
  const input = body as Record<string, unknown>;
  if (
    !Object.keys(input).length ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new BadRequestException('Campos inválidos.');
  return input;
}
export function textField(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new BadRequestException('Texto inválido.');
  return value.trim();
}
export function timezoneField(value: unknown): string {
  const timezone = textField(value, 100);
  // UTC ou identificador IANA reconhecido; não aceitar offsets avulsos.
  if (timezone !== 'UTC' && !timezone.includes('/'))
    throw new BadRequestException('Timezone inválido.');
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
  } catch {
    throw new BadRequestException('Timezone inválido.');
  }
}
