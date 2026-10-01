import { BadRequestException } from '@nestjs/common';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254)
    throw new BadRequestException('Dados inválidos.');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestException('Dados inválidos.');
  return email;
}

export function loginInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Dados inválidos.');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !['email', 'password'].includes(key)) ||
    typeof body.password !== 'string' ||
    body.password.length < 12 ||
    body.password.length > 128
  ) {
    throw new BadRequestException('Dados inválidos.');
  }
  return { email: normalizeEmail(body.email), password: body.password };
}
