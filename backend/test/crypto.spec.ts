import { createHmac } from 'crypto';
import { decryptToken, encryptToken, hashPassword, isEncryptedToken, signToken, verifyMetaSignature, verifyPassword, verifyToken } from '../src/auth/crypto';

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });
});

describe('signed tokens', () => {
  it('round-trips a valid token', () => {
    expect(verifyToken(signToken('u1', 'session', 60), 'session')?.sub).toBe('u1');
  });

  it('rejects tampered, expired and wrong-type tokens', () => {
    const token = signToken('u1', 'session', 60);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'u2', typ: 'session', exp: 9e9, iat: 0 })).toString('base64url')}.${s}`;
    expect(verifyToken(forged, 'session')).toBeNull();
    expect(verifyToken(signToken('u1', 'session', -1), 'session')).toBeNull();
    expect(verifyToken(signToken('u1', 'oauth_state', 60), 'session')).toBeNull();
    expect(verifyToken('not-a-token', 'session')).toBeNull();
  });
});

describe('access token encryption', () => {
  it('encrypts with a fresh IV and decrypts back', () => {
    const a = encryptToken('EAAB-secret');
    const b = encryptToken('EAAB-secret');
    expect(isEncryptedToken(a)).toBe(true);
    expect(a).not.toContain('EAAB-secret');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('EAAB-secret');
  });

  it('passes legacy plaintext through and refuses tampered ciphertext', () => {
    expect(decryptToken('legacy-plain')).toBe('legacy-plain');
    const enc = encryptToken('EAAB-secret');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptToken(tampered)).toThrow();
  });
});

describe('Meta webhook signatures', () => {
  const body = Buffer.from('{"entry":[]}');
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a signature from any configured secret', () => {
    expect(verifyMetaSignature(body, sign('a'), ['a', 'b'])).toBe(true);
    expect(verifyMetaSignature(body, sign('b'), ['a', 'b'])).toBe(true);
  });

  it('rejects missing, malformed and wrong signatures', () => {
    expect(verifyMetaSignature(body, undefined, ['a'])).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', ['a'])).toBe(false);
    expect(verifyMetaSignature(body, sign('c'), ['a', 'b'])).toBe(false);
    expect(verifyMetaSignature(undefined, sign('a'), ['a'])).toBe(false);
    expect(verifyMetaSignature(body, sign('a'), [])).toBe(false);
  });
});
