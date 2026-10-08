'use client';

import Link from 'next/link';
import './shell.css';
import { FEATURE_LABELS } from '../lib/nav';
import { featureOn, useMe, type FeatureKey } from '../lib/session';

export const NOT_ON = 'Not switched on for your account';

/** A short reason shown beside a control that is disabled because its switch is off. */
export function NotOnHint({ id }: { id?: string }) {
  return <span className="form-hint not-on-hint" id={id}>{NOT_ON}.</span>;
}

/**
 * Wraps a whole section. When its switch is off the page is never rendered, so a typed address shows this calm panel
 * instead. In a read-only preview it says so, because the person looking is staff seeing what the client sees.
 */
export default function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const me = useMe();
  if (!me) return null;
  if (featureOn(me, feature)) return <>{children}</>;

  const preview = me.acting && me.readOnlyPreview;
  const what = FEATURE_LABELS[feature] || 'This part of Motion';
  return (
    <section className="gate-panel card" role="status" aria-labelledby="gate-title">
      <h1 id="gate-title">This is not switched on for your account</h1>
      {preview ? (
        <p>This is what the client sees. {me.client?.name || 'This client'} does not have {what} switched on.</p>
      ) : (
        <p>Ask your account manager if you would like {what} added.</p>
      )}
      <Link className="btn btn-ghost" href="/">Back to Overview</Link>
    </section>
  );
}
