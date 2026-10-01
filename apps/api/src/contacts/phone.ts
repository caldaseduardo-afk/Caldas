import { BadRequestException } from '@nestjs/common';

// Normalização sintática; não comprova existência, posse ou disponibilidade no WhatsApp.
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64)
    throw new BadRequestException('Telefone inválido.');
  const input = value.trim();
  if (!/^\+?[0-9 ().-]+$/.test(input))
    throw new BadRequestException('Telefone inválido.');
  const digits = input.replace(/[^0-9]/g, '');
  let normalized: string;
  if (input.startsWith('+')) normalized = `+${digits}`;
  else if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith('55')
  )
    normalized = `+${digits}`;
  else if (digits.length === 10 || digits.length === 11)
    normalized = `+55${digits}`;
  else
    throw new BadRequestException('Informe DDD ou código internacional com +.');
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized))
    throw new BadRequestException('Telefone inválido.');
  if (
    normalized.startsWith('+55') &&
    !/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(normalized.slice(3))
  )
    throw new BadRequestException('Telefone brasileiro inválido.');
  return normalized;
}
