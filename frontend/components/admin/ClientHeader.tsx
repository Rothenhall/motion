'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConfirm } from '../ConfirmDialog';
import { Icon } from '../Icons';
import { ClientDetail, clientAction } from '../../lib/admin';
import { errorText } from '../../lib/format';
import { startPreview } from '../../lib/preview';
import EditClientDialog from './EditClientDialog';
import StatusBadge from './StatusBadge';

/** Name, status and the things staff do to a whole client: edit, preview, pause, archive. */
export default function ClientHeader({ client, onChanged }: { client: ClientDetail; onChanged: () => void | Promise<void> }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const suspended = client.status === 'SUSPENDED';

  const act = async (action: 'suspend' | 'activate' | 'archive' | 'unarchive', done: string) => {
    setBusy(action);
    try {
      await clientAction(client.id, action);
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error(errorText(e, 'Could not do that. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleSuspend = async () => {
    if (suspended) return act('activate', `${client.name} is active again`);
    const ok = await confirm({ title: `Suspend ${client.name}?`, description: 'Their people are signed out at once and nothing publishes until you activate the client again.', confirmLabel: 'Suspend', destructive: true });
    if (ok) await act('suspend', `${client.name} suspended`);
  };

  const toggleArchive = async () => {
    if (client.archived) return act('unarchive', `${client.name} restored. It is still suspended until you activate it.`);
    const ok = await confirm({ title: `Archive ${client.name}?`, description: 'The client is hidden from the lists and suspended. Nothing is deleted, and you can restore it later.', confirmLabel: 'Archive', destructive: true });
    if (ok) await act('archive', `${client.name} archived`);
  };

  const preview = async (mode: 'view' | 'admin') => {
    setBusy('preview');
    try {
      await startPreview({ id: client.id, name: client.name }, mode);
      router.push('/');
    } catch (e) {
      toast.error(errorText(e, 'Could not start the preview.'));
      setBusy(null);
    }
  };

  return (
    <header className="adm-head">
      <div>
        <Link className="adm-back" href="/admin/clients"><Icon name="arrow-left" size={13} /> All clients</Link>
        <div className="adm-title-row">
          <h1>{client.name}</h1>
          <StatusBadge status={client.archived ? 'ARCHIVED' : client.status} />
          {client.staffWorkspace && <span className="adm-tag">Staff workspace</span>}
        </div>
        {client.notes && <p className="adm-notes">{client.notes}</p>}
      </div>

      <div className="adm-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="btn" type="button" disabled={client.archived || busy === 'preview'}>
              <Icon name="external" size={14} /> {busy === 'preview' ? 'Opening…' : 'Preview as client'} <Icon name="chevron-down" size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-64">
            <DropdownMenuLabel className="font-normal text-muted-foreground">Open the app as {client.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void preview('view')}>View as client (read only)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void preview('admin')}>With admin controls</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button className="btn btn-ghost" type="button" onClick={() => setEditing(true)}><Icon name="settings" size={14} /> Edit</button>

        {!client.archived && (
          <button className={`btn ${suspended ? '' : 'btn-ghost'}`} type="button" onClick={() => void toggleSuspend()} disabled={!!busy}>
            <Icon name={suspended ? 'play' : 'pause'} size={14} /> {busy === 'suspend' ? 'Suspending…' : busy === 'activate' ? 'Activating…' : suspended ? 'Activate' : 'Suspend'}
          </button>
        )}
        {!client.staffWorkspace && (
          <button className="btn btn-ghost" type="button" onClick={() => void toggleArchive()} disabled={!!busy}>
            {busy === 'archive' ? 'Archiving…' : busy === 'unarchive' ? 'Restoring…' : client.archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
      </div>

      <EditClientDialog client={client} open={editing} onOpenChange={setEditing} onSaved={() => void onChanged()} />
      {confirmDialog}
    </header>
  );
}
