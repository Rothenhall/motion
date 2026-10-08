'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { setRequireApproval } from '@/lib/approvals';
import { errorText } from '@/lib/format';
import '@/components/approvals/approvals.css';

/** Per-client switch: should new posts from this client's people wait for staff approval? */
export default function RequireApprovalToggle({ clientId, value, onChange }: { clientId: string; value: boolean; onChange?: (value: boolean) => void }) {
  const [on, setOn] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(value), [value]);

  const flip = async (next: boolean) => {
    const before = on;
    setOn(next); setBusy(true);
    try {
      await setRequireApproval(clientId, next);
      onChange?.(next);
      toast.success(next ? 'Approval is now required' : 'Approval is turned off');
    } catch (e) {
      setOn(before);
      toast.error(errorText(e, 'Could not change this setting.'));
    } finally { setBusy(false); }
  };

  const id = `require-approval-${clientId}`;
  return (
    <div className="ap-toggle">
      <Switch id={id} checked={on} disabled={busy} onCheckedChange={flip} aria-describedby={`${id}-help`} />
      <div className="ap-toggle-copy">
        <label htmlFor={id}>Require approval</label>
        <p id={`${id}-help`}>New posts from this client&apos;s people wait here for your approval before they are scheduled. Staff posts are never held.</p>
      </div>
    </div>
  );
}
