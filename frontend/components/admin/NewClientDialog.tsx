'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientRow, InviteLink, createClient } from '../../lib/admin';
import { isApiError } from '../../lib/api';
import { LinkDetails } from './CopyLinkDialog';

/** Name and main contact in, invite link out. The link is the only way the contact gets in, so it stays on screen until closed. */
export default function NewClientDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: (client: ClientRow) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ client: ClientRow; invite: InviteLink } | null>(null);

  const reset = () => { setName(''); setEmail(''); setError(''); setCreated(null); setBusy(false); };
  const change = (next: boolean) => { if (!next) reset(); onOpenChange(next); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await createClient(name.trim(), email.trim());
      setCreated(result);
      onCreated?.(result.client);
    } catch (e) {
      // 400: the name or email is not valid. 409: the email already has an account. The server's words are already plain.
      setError(isApiError(e) ? e.message : 'Could not create the client. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.client.name} is ready</DialogTitle>
              <DialogDescription>Send this invite link to the main contact. It works once. If you lose it, send a new invite from the Team tab.</DialogDescription>
            </DialogHeader>
            <LinkDetails link={created.invite} label="Invite link" />
            <DialogFooter>
              <Link className="btn btn-ghost" href={`/admin/clients/${created.client.id}`} onClick={() => change(false)}>Open client</Link>
              <button className="btn" type="button" onClick={() => change(false)}>Done</button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="adm-form" noValidate>
            <DialogHeader>
              <DialogTitle>New client</DialogTitle>
              <DialogDescription>Give the client a name and say who their main contact is. You get a link to send them.</DialogDescription>
            </DialogHeader>
            <div className="field">
              <label className="field-label" htmlFor="new-client-name">Client name</label>
              <input id="new-client-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} required aria-invalid={!!error || undefined} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="new-client-email">Main contact email</label>
              <input id="new-client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required aria-invalid={!!error || undefined} aria-describedby={error ? 'new-client-error' : undefined} />
            </div>
            <p id="new-client-error" className="form-error" role="alert">{error}</p>
            <DialogFooter>
              <button className="btn btn-ghost" type="button" onClick={() => change(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy || name.trim().length < 2 || !email.trim()}>{busy ? 'Creating…' : 'Create client'}</button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
