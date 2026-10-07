'use client';

import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientRow, updateClient } from '../../lib/admin';
import { isApiError } from '../../lib/api';

/** Rename a client and keep private notes about it. Only what changed is sent. */
export default function EditClientDialog({ client, open, onOpenChange, onSaved }: { client: ClientRow; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState(client.name);
  const [notes, setNotes] = useState(client.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setName(client.name); setNotes(client.notes ?? ''); setError(''); }
  }, [open, client.name, client.notes]);

  const changed = name.trim() !== client.name || notes.trim() !== (client.notes ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !changed) return;
    const patch: { name?: string; notes?: string | null } = {};
    if (name.trim() !== client.name) patch.name = name.trim();
    if (notes.trim() !== (client.notes ?? '')) patch.notes = notes.trim() || null;
    setBusy(true);
    setError('');
    try {
      await updateClient(client.id, patch);
      toast.success('Client saved');
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="adm-form" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>Notes are only seen by staff.</DialogDescription>
          </DialogHeader>
          <div className="field">
            <label className="field-label" htmlFor="edit-client-name">Client name</label>
            <input id="edit-client-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-client-notes">Notes</label>
            <textarea id="edit-client-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={4} />
          </div>
          <p className="form-error" role="alert">{error}</p>
          <DialogFooter>
            <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="btn" type="submit" disabled={busy || !changed || name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
