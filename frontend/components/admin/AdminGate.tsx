'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { isStaff, useSession } from '../../lib/session';
import { ErrorNotice } from './Feedback';

/**
 * Only staff see the console. While we are still asking who is signed in, nothing shows (so a client never sees a flash of
 * admin screens); anyone who is not staff is sent to the home page.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { status, me, error, refresh } = useSession();
  const router = useRouter();
  const allowed = status === 'ready' && isStaff(me);
  const turnAway = status === 'ready' && !isStaff(me);

  useEffect(() => {
    if (turnAway) router.replace('/');
  }, [turnAway, router]);

  if (status === 'error') return <ErrorNotice message={error || 'Could not reach Motion.'} onRetry={() => void refresh()} />;
  if (!allowed) return null;
  return <>{children}</>;
}
