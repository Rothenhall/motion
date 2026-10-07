'use client';

import { ErrorNotice, EmptyBlock, SkeletonRows } from './Feedback';
import { useLoad } from './hooks';
import { ClientPost, exactTime, getClientPosts, plural, providerLabel, timeAgo } from '../../lib/admin';
import type { ClientTabProps } from './types';

const snippet = (text: string | null) => (text?.trim() ? (text.length > 90 ? `${text.slice(0, 90)}…` : text) : 'No caption');

function PostList({ posts, failed }: { posts: ClientPost[]; failed?: boolean }) {
  return (
    <ul className="adm-post-list">
      {posts.map((p) => (
        <li key={p.id}>
          <div className="adm-post-main">
            <strong>{snippet(p.caption)}</strong>
            <span>{providerLabel(p.account?.provider ?? p.platform)}{p.account?.name ? ` · ${p.account.name}` : ''}</span>
            {failed && p.error && <span className="adm-post-error">{p.error}</span>}
          </div>
          <time className="adm-post-when" dateTime={p.scheduledAt} title={exactTime(p.scheduledAt)}>{timeAgo(p.scheduledAt)}</time>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewTab({ client }: ClientTabProps) {
  const posts = useLoad(() => getClientPosts(client.id), [client.id]);
  const now = Date.now();
  const next = (posts.data ?? []).filter((p) => p.status === 'SCHEDULED' && new Date(p.scheduledAt).getTime() >= now).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)).slice(0, 5);
  const failed = (posts.data ?? []).filter((p) => p.status === 'FAILED').sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)).slice(0, 5);

  return (
    <div className="adm-panel">
      <div className="adm-stats">
        <div className="card adm-tile"><span className="adm-tile-label">Channels</span><strong>{client.channels.length}</strong><span className="adm-tile-hint">{client.disconnectedChannels ? `${client.disconnectedChannels} disconnected` : 'All connected'}</span></div>
        <div className="card adm-tile"><span className="adm-tile-label">Scheduled</span><strong>{client.scheduledPosts}</strong><span className="adm-tile-hint">Posts waiting to go out</span></div>
        <div className="card adm-tile"><span className="adm-tile-label">Failed</span><strong className={client.failedPosts ? 'adm-bad' : ''}>{client.failedPosts}</strong><span className="adm-tile-hint">Posts that did not publish</span></div>
        <div className="card adm-tile"><span className="adm-tile-label">People</span><strong>{client.seatsUsed} of {client.seatLimit}</strong><span className="adm-tile-hint">{client.pendingInvites ? `${plural(client.pendingInvites, 'invite')} waiting` : 'Seats used'}</span></div>
        <div className="card adm-tile"><span className="adm-tile-label">Last activity</span><strong className="adm-small-value">{client.lastActivityAt ? timeAgo(client.lastActivityAt) : 'None yet'}</strong><span className="adm-tile-hint">Created {timeAgo(client.createdAt)}</span></div>
      </div>

      {posts.error && <ErrorNotice message={posts.error} onRetry={() => void posts.reload()} busy={posts.loading} />}
      {posts.loading && !posts.data && <SkeletonRows count={3} label="Loading posts" />}
      {posts.data && (
        <div className="adm-two">
          <section className="card" aria-labelledby="next-title">
            <div className="card-header"><h2 className="card-title" id="next-title">Next scheduled posts</h2></div>
            {next.length ? <PostList posts={next} /> : <EmptyBlock icon="calendar" title="Nothing scheduled">New posts show up here.</EmptyBlock>}
          </section>
          <section className="card" aria-labelledby="failed-title">
            <div className="card-header"><h2 className="card-title" id="failed-title">Recent failures</h2></div>
            {failed.length ? <PostList posts={failed} failed /> : <EmptyBlock icon="check" title="No failed posts">Everything that was due has gone out.</EmptyBlock>}
          </section>
        </div>
      )}
    </div>
  );
}
