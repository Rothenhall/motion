import { isApiError } from './api';

/**
 * Loads one part of a page. If the server says that part is switched off for this client (FEATURE_DISABLED), the part
 * quietly goes away: `onBlocked` is told which switch, and the fallback is returned so the rest of the page keeps working.
 * Any other failure is thrown as usual.
 */
export async function tolerate<T>(request: Promise<T>, fallback: T, onBlocked?: (feature?: string) => void): Promise<T> {
  try {
    return await request;
  } catch (e) {
    if (isApiError(e, 'FEATURE_DISABLED')) { onBlocked?.(e.feature); return fallback; }
    throw e;
  }
}
