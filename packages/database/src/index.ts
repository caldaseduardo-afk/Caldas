import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// Infraestrutura de backend. Não importar no frontend ou nas tools da IA.
export function createDatabaseClient(connectionString: string) {
  if (!connectionString.trim()) {
    throw new Error('DATABASE_URL deve ser configurada.');
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // TypeError de URL inclui o input original; não propagar credenciais.
    throw new Error('DATABASE_URL inválida.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL deve apontar para PostgreSQL.');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [],
  });
}
