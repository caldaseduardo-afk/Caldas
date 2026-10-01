import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 131072;
let active = 0;
export class PasswordBusyError extends Error {}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new PasswordBusyError();
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, key) => {
          if (error) reject(error);
          else resolve(key);
        },
      );
    });
  } finally {
    active--;
  }
}

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error('Senha deve ter entre 12 e 128 caracteres.');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

// Hash fictício: mesma carga criptográfica quando a conta não existe.
const DUMMY_HASH = `scrypt$${N}$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
export async function verifyPassword(password: string, stored = DUMMY_HASH) {
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    stored,
  );
  const valid = match !== null;
  const parts =
    match ??
    /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(DUMMY_HASH)!;
  const actual = await derive(password, Buffer.from(parts[1]!, 'hex'));
  return timingSafeEqual(actual, Buffer.from(parts[2]!, 'hex')) && valid;
}
