'use client';

import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Icon } from '../Icons';
import { useConfirm } from '../ConfirmDialog';
import { InviteLink, Member, TeamPayload, disableUser, enableUser, exactTime, getTeam, inviteMember, resendInvite, resetLink, roleLabel, setSeatLimit, timeAgo } from '../../lib/admin';
import { errorText } from '../../lib/format';
import CopyLinkDialog, { LinkDetails } from './CopyLinkDialog';
import { EmptyBlock, ErrorNotice, SkeletonRows } from './Feedback';
import StatusBadge from './StatusBadge';
import { useLoad } from './hooks';
import type { ClientTabProps } from './types';

function InviteDialog({ clientId, open, onOpenChange, onInvited }: { clientId: string; open: boolean; onOpenChange: (open: boolean) => void; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'CLIENT_MEMBER' | 'CLIENT_POC'>('CLIENT_MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<InviteLink | null>(null);

  // Start fresh each time it opens (not when it closes, so the content does not change while it fades out).
  useEffect(() => {
    if (open) { setEmail(''); setRole('CLIENT_MEMBER'); setError(''); setLink(null); }
  }, [open]);
  const change = (next: boolean) => onOpenChange(next);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await inviteMember(clientId, email.trim(), role);
      setLink(result.invite);
      onInvited();
    } catch (e) {
      setError(errorText(e, 'Could not invite this person.')); // SEAT_LIMIT and email-taken messages come from the server
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite link ready</DialogTitle>
              <DialogDescription>This link works once. If you lose it, send a new invite from the list.</DialogDescription>
            </DialogHeader>
            <LinkDetails link={link} label="Invite link" />
            <DialogFooter><button className="btn" type="button" onClick={() => change(false)}>Done</button></DialogFooter>
          </>
        ) : (
          <form className="adm-form" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription>They use one seat. You get a link to send them.</DialogDescription>
            </DialogHeader>
            <div className="field">
              <label className="field-label" htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required aria-invalid={!!error || undefined} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="invite-role">Role</label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as 'CLIENT_MEMBER' | 'CLIENT_POC')}>
                <option value="CLIENT_MEMBER">Member</option>
                <option value="CLIENT_POC">Main contact</option>
              </Select>
            </div>
            <p className="form-error" role="alert">{error}</p>
            <DialogFooter>
              <button className="btn btn-ghost" type="button" onClick={() => change(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy || !email.trim()}>{busy ? 'Inviting…' : 'Create invite link'}</button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TeamTab({ client, reload }: ClientTabProps) {
  const team = useLoad<TeamPayload>(() => getTeam(client.id), [client.id]);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ title: string; link: InviteLink } | null>(null);
  const [seats, setSeats] = useState(String(client.seatLimit));
  const [seatError, setSeatError] = useState('');

  useEffect(() => { setSeats(String(client.seatLimit)); }, [client.seatLimit]);

  const refresh = async () => { await Promise.all([team.reload(), reload()]); };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setActionError('');
    try { await action(); }
    catch (e) { const message = errorText(e, 'That did not work. Try again.'); setActionError(message); toast.error(message); }
    finally { setBusy(null); }
  };

  const saveSeats = async (event: FormEvent) => {
    event.preventDefault();
    const limit = Number(seats);
    setBusy('seats');
    setSeatError('');
    try {
      await setSeatLimit(client.id, limit);
      toast.success(`Seat limit is now ${limit}`);
      await refresh();
    } catch (e) {
      setSeatError(errorText(e, 'Could not change the seat limit.')); // e.g. "3 seats are in use. Remove people first."
    } finally {
      setBusy(null);
    }
  };

  const onResend = (m: Member) => run(`resend-${m.id}`, async () => {
    const result = await resendInvite(m.id);
    setLink({ title: `New invite link for ${m.email}`, link: result.invite });
  });
  const onReset = (m: Member) => run(`reset-${m.id}`, async () => {
    const result = await resetLink(m.id);
    setLink({ title: `Reset link for ${m.email}`, link: result.reset });
  });
  const onDisable = async (m: Member) => {
    if (!(await confirm({ title: `Disable ${m.email}?`, description: 'They are signed out at once and their seat is freed.', confirmLabel: 'Disable', destructive: true }))) return;
    await run(`disable-${m.id}`, async () => { await disableUser(m.id); toast.success(`${m.email} disabled`); await refresh(); });
  };
  const onEnable = (m: Member) => run(`enable-${m.id}`, async () => { await enableUser(m.id); toast.success(`${m.email} enabled`); await refresh(); });

  const data = team.data;
  const seatNumber = Number(seats);
  const seatsChanged = Number.isInteger(seatNumber) && seatNumber !== (data?.seats.limit ?? client.seatLimit);

  return (
    <div className="adm-panel">
      <section className="card" aria-labelledby="seats-title">
        <div className="card-header"><div><h2 className="card-title" id="seats-title">Seats</h2><p className="card-subtitle">Active and invited people use a seat. Staff do not.</p></div></div>
        <p className="adm-seats-text" role="status">{data ? `${data.seats.used} of ${data.seats.limit} seats used.` : 'Loading seats…'}</p>
        <form className="adm-seats" onSubmit={saveSeats}>
          <div className="field">
            <label className="field-label" htmlFor="seat-limit">Seat limit</label>
            <input id="seat-limit" type="number" min={1} max={1000} step={1} value={seats} onChange={(e) => setSeats(e.target.value)} aria-invalid={!!seatError || undefined} aria-describedby={seatError ? 'seat-error' : undefined} />
          </div>
          <button className="btn" type="submit" disabled={busy === 'seats' || !seatsChanged}>{busy === 'seats' ? 'Saving…' : 'Save seats'}</button>
        </form>
        <p id="seat-error" className="form-error" role="alert">{seatError}</p>
      </section>

      <section className="card data-card" aria-labelledby="people-title">
        <div className="card-header">
          <div><h2 className="card-title" id="people-title">People {data && <span className="list-count">{data.members.length}</span>}</h2></div>
          <button className="btn btn-sm" type="button" onClick={() => setInviting(true)}><Icon name="plus" size={13} /> Invite member</button>
        </div>
        {actionError && <div className="adm-pad"><ErrorNotice message={actionError} /></div>}
        {team.error && !data && <div className="adm-pad"><ErrorNotice message={team.error} onRetry={() => void team.reload()} busy={team.loading} /></div>}
        {!data && !team.error && <div className="adm-pad"><SkeletonRows count={3} label="Loading people" /></div>}
        {data && data.members.length === 0 && <EmptyBlock icon="inbox" title="No one has been invited">Invite the main contact to get started.</EmptyBlock>}
        {data && data.members.length > 0 && (
          <div className="table-wrap">
            <table className="data-table adm-table">
              <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Person"><strong className="adm-person">{m.email}</strong></td>
                    <td data-label="Role" className="table-secondary">{roleLabel(m.role)}</td>
                    <td data-label="Status"><StatusBadge status={m.status} /></td>
                    <td data-label="Last sign-in" className="table-secondary"><span title={exactTime(m.lastLoginAt)}>{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</span></td>
                    <td className="adm-actions-cell">
                      <div className="adm-row-actions">
                        {m.status === 'INVITED' && <button className="btn btn-ghost btn-sm" type="button" disabled={!!busy} onClick={() => void onResend(m)} aria-label={`Resend invite to ${m.email}`}>{busy === `resend-${m.id}` ? 'Sending…' : 'Resend invite'}</button>}
                        {m.status === 'ACTIVE' && <button className="btn btn-ghost btn-sm" type="button" disabled={!!busy} onClick={() => void onReset(m)} aria-label={`Make a reset link for ${m.email}`}>{busy === `reset-${m.id}` ? 'Making…' : 'Reset link'}</button>}
                        {m.status !== 'DISABLED' && <button className="btn btn-danger btn-sm" type="button" disabled={!!busy} onClick={() => void onDisable(m)} aria-label={`Disable ${m.email}`}>{busy === `disable-${m.id}` ? 'Disabling…' : 'Disable'}</button>}
                        {m.status === 'DISABLED' && <button className="btn btn-ghost btn-sm" type="button" disabled={!!busy} onClick={() => void onEnable(m)} aria-label={`Enable ${m.email}`}>{busy === `enable-${m.id}` ? 'Enabling…' : 'Enable'}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <InviteDialog clientId={client.id} open={inviting} onOpenChange={setInviting} onInvited={() => void refresh()} />
      <CopyLinkDialog open={!!link} onOpenChange={(open) => { if (!open) setLink(null); }} title={link?.title ?? ''} link={link?.link ?? null} label="Link" />
      {confirmDialog}
    </div>
  );
}
