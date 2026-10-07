'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Select } from '@/components/ui/select';
import { Icon } from '../Icons';
import { useConfirm } from '../ConfirmDialog';
import { AdminChannel, ConnectProvider, addChannelByToken, connectRouteFor, disconnectChannel, exactTime, getChannels, providerLabel, startConnect, timeAgo } from '../../lib/admin';
import { errorText, platformFor } from '../../lib/format';
import { EmptyBlock, ErrorNotice, SkeletonRows } from './Feedback';
import StatusBadge from './StatusBadge';
import { useLoad } from './hooks';
import type { ClientTabProps } from './types';

const CONNECTABLE: { id: ConnectProvider; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'threads', label: 'Threads' },
];

function tokenText(c: AdminChannel): string {
  if (!c.connected) return 'No token';
  if (!c.tokenExpires) return 'Token does not expire';
  const left = new Date(c.tokenExpires).getTime() - Date.now();
  return left <= 0 ? `Token expired ${timeAgo(c.tokenExpires)}` : `Token expires ${timeAgo(c.tokenExpires)}`;
}

function AddByToken({ clientId, onAdded }: { clientId: string; onAdded: () => void }) {
  const [provider, setProvider] = useState('instagram');
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await addChannelByToken(clientId, {
        provider, externalId: externalId.trim(), accessToken: token.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(expires ? { tokenExpires: new Date(expires).toISOString() } : {}),
      });
      toast.success('Channel added');
      setExternalId(''); setName(''); setToken(''); setExpires('');
      onAdded();
    } catch (e) {
      setError(errorText(e, 'Could not add the channel.')); // CHANNEL_ALREADY_CONNECTED names the other client
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="adm-details">
      <summary>Add a channel with a token you already hold</summary>
      <form className="adm-form" onSubmit={submit} noValidate>
        <div className="adm-grid-form">
          <div className="field">
            <label className="field-label" htmlFor="tok-provider">Platform</label>
            <Select id="tok-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="instagram">Instagram</option>
              <option value="facebook_page">Facebook Page</option>
              <option value="threads">Threads</option>
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tok-external">Account ID</label>
            <input id="tok-external" value={externalId} onChange={(e) => setExternalId(e.target.value)} autoComplete="off" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tok-name">Name (optional)</label>
            <input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tok-expires">Token expires (optional)</label>
            <input id="tok-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
          <div className="field adm-wide">
            <label className="field-label" htmlFor="tok-token">Access token</label>
            <input id="tok-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
          </div>
        </div>
        <p className="form-error" role="alert">{error}</p>
        <div className="form-actions"><button className="btn" type="submit" disabled={busy || !externalId.trim() || !token.trim()}>{busy ? 'Adding…' : 'Add channel'}</button></div>
      </form>
    </details>
  );
}

export default function ChannelsTab({ client, reload }: ClientTabProps) {
  const channels = useLoad<AdminChannel[]>(() => getChannels(client.id), [client.id]);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const handled = useRef(false);

  // Back from Meta: read the result from the address, say it, then clean the address so a refresh does not repeat it.
  useEffect(() => {
    const connected = search.get('connected');
    const error = search.get('error');
    if ((!connected && !error) || handled.current) return;
    handled.current = true;
    if (connected) {
      toast.success(`${search.get('account') || providerLabel(connected)} connected`);
      void channels.reload();
      void reload();
    } else if (error) {
      setActionError(error);
      toast.error(error);
    }
    router.replace(`${pathname}?tab=channels`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const connect = async (provider: ConnectProvider) => {
    setBusy(`connect-${provider}`);
    setActionError('');
    try {
      const { url } = await startConnect(client.id, provider);
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      setActionError(errorText(e, 'Could not start connecting.'));
    }
  };

  const disconnect = async (c: AdminChannel) => {
    const name = c.name || providerLabel(c.provider);
    if (!(await confirm({ title: `Disconnect ${name}?`, description: 'Posts for this channel stop publishing and syncing. History is kept, and you can reconnect it later.', confirmLabel: 'Disconnect', destructive: true }))) return;
    setBusy(`disconnect-${c.id}`);
    setActionError('');
    try {
      await disconnectChannel(client.id, c.id);
      toast.success(`${name} disconnected`);
      await Promise.all([channels.reload(), reload()]);
    } catch (e) {
      const message = errorText(e, 'Could not disconnect this channel.');
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const list = channels.data;
  return (
    <div className="adm-panel">
      <section className="card" aria-labelledby="connect-title">
        <div className="card-header"><div><h2 className="card-title" id="connect-title">Connect a channel</h2><p className="card-subtitle">You sign in to the platform with the account that has access to this client&apos;s profile. The channel is then linked to {client.name}.</p></div></div>
        <div className="adm-connect-row">
          {CONNECTABLE.map((p) => (
            <button key={p.id} className="btn btn-ghost" type="button" disabled={!!busy} onClick={() => void connect(p.id)}>
              <Icon name={p.id} size={14} /> {busy === `connect-${p.id}` ? 'Opening…' : `Connect ${p.label}`}
            </button>
          ))}
        </div>
        <div aria-live="polite" className="adm-live">{actionError && <ErrorNotice message={actionError} />}</div>
        <AddByToken clientId={client.id} onAdded={() => { void channels.reload(); void reload(); }} />
      </section>

      <section className="card" aria-labelledby="channels-title">
        <div className="card-header"><div><h2 className="card-title" id="channels-title">Channels {list && <span className="list-count">{list.length}</span>}</h2></div></div>
        {channels.error && !list && <ErrorNotice message={channels.error} onRetry={() => void channels.reload()} busy={channels.loading} />}
        {!list && !channels.error && <SkeletonRows count={2} label="Loading channels" />}
        {list && list.length === 0 && <EmptyBlock icon="link" title="No channels yet">Connect Instagram, Facebook or Threads above.</EmptyBlock>}
        {list && list.length > 0 && (
          <ul className="adm-channel-list">
            {list.map((c) => (
              <li className="adm-channel" key={c.id}>
                <div className="adm-channel-row-avatar">
                  <span className={`platform-avatar ${platformFor(c.provider)}`} aria-hidden="true"><Icon name={platformFor(c.provider)} size={15} /></span>
                  <div className="adm-channel-main">
                    <strong>{c.name || 'Unnamed channel'}</strong>
                    <span>{providerLabel(c.provider)} · {c.externalId}</span>
                    <span title={c.tokenExpires ? exactTime(c.tokenExpires) : undefined}>{tokenText(c)}</span>
                    {c.connected && c.insightsSyncedAt && !c.insightsError && <span>Last synced {timeAgo(c.insightsSyncedAt)}</span>}
                    {c.connected && c.insightsError && <span className="adm-sync-error">Last sync failed: {c.insightsError}</span>}
                    {!c.connected && c.disconnectedAt && <span>Disconnected {timeAgo(c.disconnectedAt)}</span>}
                  </div>
                </div>
                <StatusBadge status={c.connected ? 'CONNECTED' : 'DISCONNECTED'} />
                {c.connected ? (
                  <button className="btn btn-danger btn-sm" type="button" disabled={!!busy} onClick={() => void disconnect(c)} aria-label={`Disconnect ${c.name || providerLabel(c.provider)}`}>{busy === `disconnect-${c.id}` ? 'Disconnecting…' : 'Disconnect'}</button>
                ) : (
                  <button className="btn btn-ghost btn-sm" type="button" disabled={!!busy} onClick={() => void connect(connectRouteFor(c.provider))} aria-label={`Reconnect ${c.name || providerLabel(c.provider)}`}>{busy === `connect-${connectRouteFor(c.provider)}` ? 'Opening…' : 'Reconnect'}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
