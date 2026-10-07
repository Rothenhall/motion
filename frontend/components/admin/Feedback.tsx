import { ReactNode } from 'react';
import { Icon } from '../Icons';

/** An error with a way to try again. Announced to screen readers as soon as it appears. */
export function ErrorNotice({ message, onRetry, busy }: { message: string; onRetry?: () => void; busy?: boolean }) {
  return (
    <div className="notice notice-error adm-notice" role="alert">
      <Icon name="alert" size={15} />
      <span className="adm-notice-text">{message}</span>
      {onRetry && <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>}
    </div>
  );
}

/** A calm, non-error message (for results and hints). */
export function InfoNotice({ children, tone = 'success' }: { children: ReactNode; tone?: 'success' | 'warning' }) {
  return <div className={`notice notice-${tone} adm-notice`} role="status"><Icon name={tone === 'success' ? 'check' : 'alert'} size={15} /><span className="adm-notice-text">{children}</span></div>;
}

export function EmptyBlock({ icon = 'grid', title, children }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state adm-empty">
      <div className="empty-icon"><Icon name={icon} size={18} /></div>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Placeholder rows while something loads. Hidden from screen readers; the region says it is busy. */
export function SkeletonRows({ count = 3, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="adm-skeletons" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
    </div>
  );
}
