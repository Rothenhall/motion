import { setActing, setToken } from './api';
import { homePathFor } from './nav';

/** What the sign-in, invite and reset endpoints all return. */
export interface SessionResponse { token: string; user: { id: string; email: string; role: string } }

/** Keep the new session and go to the right home: staff to the admin area, clients to their Overview. */
export function finishSignIn(res: SessionResponse, navigate: (path: string) => void = (path) => window.location.assign(path)) {
  setActing(null); // a new sign-in never starts inside an old preview
  setToken(res.token);
  navigate(homePathFor(res.user.role));
}

export const MIN_PASSWORD = 8;

/** Plain-words problem with a new password, or null when it is fine. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

export const ROLE_WORDS: Record<string, string> = {
  CLIENT_POC: 'the main contact for the workspace',
  CLIENT_MEMBER: 'a team member',
  ADMIN: 'staff',
};

export const LINK_INVALID = 'This link is no longer valid. Ask your account manager for a new one.';
