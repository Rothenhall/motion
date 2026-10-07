import { Role } from '@prisma/client';
import { signToken } from './crypto';

export const SESSION_TTL = 7 * 24 * 60 * 60;

/** A session token plus the user it is for. The token carries the user's session version, so a password reset or a disabled account ends older sessions. */
export function sessionFor(user: { id: string; email: string; role: Role; sessionVersion: number }) {
  return { token: signToken(user.id, 'session', SESSION_TTL, { sv: user.sessionVersion }), user: { id: user.id, email: user.email, role: user.role } };
}
