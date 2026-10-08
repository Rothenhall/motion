import { ReactNode } from 'react';

type Tone = 'good' | 'warn' | 'bad' | 'quiet';

const TONE_CLASS: Record<Tone, string> = { good: 'status-active', warn: 'status-scheduled', bad: 'status-failed', quiet: 'status-draft' };

const KNOWN: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'good' },
  SUSPENDED: { label: 'Suspended', tone: 'bad' },
  ARCHIVED: { label: 'Archived', tone: 'quiet' },
  INVITED: { label: 'Invited', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'quiet' },
  CONNECTED: { label: 'Connected', tone: 'good' },
  DISCONNECTED: { label: 'Disconnected', tone: 'bad' },
};

/** One small pill for every status in the console, so the same word always looks the same. */
export default function StatusBadge({ status, tone, children }: { status: string; tone?: Tone; children?: ReactNode }) {
  const known = KNOWN[status.toUpperCase()];
  const t = tone ?? known?.tone ?? 'quiet';
  return <span className={`status-pill ${TONE_CLASS[t]}`}>{children ?? known?.label ?? status}</span>;
}
