import { Icon } from '../Icons';
import { ClientRow, plural, providerLabel } from '../../lib/admin';
import { platformFor } from '../../lib/format';

export default function ChannelIcons({ client }: { client: Pick<ClientRow, 'channels' | 'disconnectedChannels'> }) {
  if (!client.channels.length && !client.disconnectedChannels) return <span className="table-secondary">None</span>;
  return (
    <span className="adm-channel-icons">
      {client.channels.map((c) => (
        <span key={c.id} className={`platform-avatar ${platformFor(c.provider)}`} title={`${providerLabel(c.provider)}${c.name ? `: ${c.name}` : ''}`} role="img" aria-label={`${providerLabel(c.provider)}${c.name ? `, ${c.name}` : ''}`}>
          <Icon name={platformFor(c.provider)} size={13} />
        </span>
      ))}
      {client.disconnectedChannels > 0 && <span className="adm-muted-count">{plural(client.disconnectedChannels, 'disconnected channel')}</span>}
    </span>
  );
}
