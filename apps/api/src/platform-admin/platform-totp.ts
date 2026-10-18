import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encodeSecret(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function decodeSecret(text: string) {
  if (!/^[A-Z2-7]+$/.test(text)) throw new Error('MFA_SECRET_INVALID');
  let bits = 0,
    value = 0;
  const result: number[] = [];
  for (const char of text) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(result);
}
export function totp(secret: string, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', decodeSecret(secret))
      .update(counter)
      .digest(),
    offset = hash[hash.length - 1] & 15;
  return String(
    (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, '0');
}
export function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastStep: bigint,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(+now / 30000);
  let match: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const candidate = step + offset;
    if (candidate < 0) continue;
    if (
      timingSafeEqual(
        Buffer.from(totp(secret, candidate)),
        Buffer.from(code),
      ) &&
      BigInt(candidate) > lastStep
    )
      match = candidate;
  }
  return match;
}
function key() {
  const raw = process.env.PLATFORM_MFA_KEY ?? '';
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(raw) ||
    Buffer.from(raw, 'base64').length !== 32
  )
    throw new Error('PLATFORM_MFA_KEY_REQUIRED');
  return Buffer.from(raw, 'base64');
}
export function encryptSecret(secret: string, userId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString('base64'))
    .join('.');
}
export function decryptSecret(value: string, userId: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('MFA_SECRET_INVALID');
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString(
    'utf8',
  );
}
