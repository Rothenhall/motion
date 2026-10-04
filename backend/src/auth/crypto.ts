import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See backend/.env.example.`);
  return value;
}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

const b64url = (buf: Buffer) => buf.toString('base64url');

// ---------- passwords (scrypt) ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return safeEqual(actual, expected);
}

// ---------- signed tokens (HS256 JWT) ----------

export type TokenType = 'session' | 'oauth_state';
export type TokenPayload = { sub: string; typ: TokenType; exp: number; iat: number; [k: string]: unknown };

const JWT_HEADER = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

function jwtSignature(input: string) {
  return createHmac('sha256', requireEnv('AUTH_SECRET')).update(input).digest();
}

export function signToken(sub: string, typ: TokenType, ttlSeconds: number, extra: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(Buffer.from(JSON.stringify({ ...extra, sub, typ, iat: now, exp: now + ttlSeconds })));
  return `${JWT_HEADER}.${body}.${b64url(jwtSignature(`${JWT_HEADER}.${body}`))}`;
}

/** Returns the payload only when the signature, type and expiry all check out. */
export function verifyToken(token: string, typ: TokenType): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== JWT_HEADER) return null;
  if (!safeEqual(Buffer.from(parts[2], 'base64url'), jwtSignature(`${parts[0]}.${parts[1]}`))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as TokenPayload;
    if (payload.typ !== typ || typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- access-token encryption at rest (AES-256-GCM) ----------

const ENC_PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const key = Buffer.from(requireEnv('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
  return key;
}

export function isEncryptedToken(value: string) {
  return value.startsWith(ENC_PREFIX);
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(ct)}`;
}

/** Decrypts a stored token. Plaintext from before encryption passes through until the boot-time backfill rewrites it. */
export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) return stored;
  const [iv, tag, ct] = stored.slice(ENC_PREFIX.length).split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------- Meta webhook signatures ----------

/** Checks X-Hub-Signature-256 ("sha256=<hex>") against any of the given app secrets. */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, secrets: string[]): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return secrets.some((secret) => safeEqual(given, createHmac('sha256', secret).update(rawBody).digest()));
}

/** Fails fast at boot so a misconfigured deploy never runs with auth or encryption half-working. */
export function assertSecurityConfig() {
  if (requireEnv('AUTH_SECRET').length < 32) throw new Error('AUTH_SECRET must be at least 32 characters (openssl rand -base64 48).');
  encryptionKey();
}
