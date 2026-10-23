import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A dummy hash so failed lookups take as long as real password checks. */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Device session token. Only its SHA-256 is stored. */
export function newDeviceToken(): { token: string; hash: string } {
  const token = `tsh_${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
}
export const isTokenShaped = (t: string) => /^tsh_[A-Za-z0-9_-]{43}$/.test(t);

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
/** One-time code to connect a viewing device, e.g. "K7QM-4XPA". */
export function newPairingCode(): { code: string; hash: string } {
  const bytes = randomBytes(8);
  let raw = '';
  for (const b of bytes) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, hash: sha256(raw) };
}
export function pairingHash(input: string): string | null {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 8 || [...raw].some(c => !CODE_ALPHABET.includes(c))) return null;
  return sha256(raw);
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Furaha sirta ah waa inuu ahaadaa ugu yaraan 8 xaraf.';
  if (password.length > 128) return 'Furaha sirta ah aad buu u dheer yahay.';
  return null;
}

/** Ten one-time recovery codes, e.g. "K7QM4-XPA2B" (50 random bits each). Shown once; stored only as scrypt hashes. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    let raw = '';
    for (const b of randomBytes(10)) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
/** Canonical form for hashing and checking: upper case, no spaces or dashes. Null when it cannot be a code. */
export function normalizeRecoveryCode(input: unknown): string | null {
  const raw = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== 10 || [...raw].some(c => !CODE_ALPHABET.includes(c))) return null;
  return raw;
}
