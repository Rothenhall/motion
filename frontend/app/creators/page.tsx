'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import CreatorCard, { type Creator } from '../../components/creators/CreatorCard';
import { Icon } from '../../components/Icons';
import { Select } from '@/components/ui/select';
import { api, isApiError } from '../../lib/api';
import { errorText } from '../../lib/format';

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Criteria = {
  query?: string;
  creatorCountries: string[];
  creatorMinFollowers?: number;
  creatorMaxFollowers?: number;
  creatorInterests: string[];
  creatorGender?: string;
  creatorAgeBucket?: string;
  majorAudienceCountries: string[];
  recommendationType?: string;
  similarTo: string[];
};

const FOLLOWERS = [
  { value: '', label: 'Any followers' },
  { value: '10000', label: '10K+' },
  { value: '25000', label: '25K+' },
  { value: '50000', label: '50K+' },
  { value: '100000', label: '100K+' },
  { value: '250000', label: '250K+' },
];

const INTERESTS = ['', 'BEAUTY', 'FASHION', 'FITNESS_AND_WORKOUTS', 'FOOD_AND_DRINK', 'TRAVEL_AND_LEISURE_ACTIVITIES', 'MUSIC_AND_AUDIO', 'SPORTS', 'BUSINESS_FINANCE_AND_ECONOMICS'];

const interestLabel = (v: string) => (v ? v.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : 'Any interest');

const GREETING: ChatMsg = { role: 'assistant', content: 'Tell me what you are promoting and I will find matching Instagram creators. Start with your niche, for example "sourdough bakery in Mumbai".' };

type Saved = { id: string; username: string; country: string | null; followers: number | null };

export default function Creators() {
  const [aiReady, setAiReady] = useState(true);
  const [blocked, setBlocked] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING]);
  const [draft, setDraft] = useState('');
  const [chatting, setChatting] = useState(false);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [source, setSource] = useState<'live' | 'sample' | null>(null);
  const [notice, setNotice] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [shortlist, setShortlist] = useState<Saved[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [filters, setFilters] = useState({ query: '', country: '', minFollowers: '', interest: '' });
  const bottomRef = useRef<HTMLDivElement>(null);

  const fail = (error: unknown, fallback: string) => {
    if (isApiError(error, 'FEATURE_DISABLED')) {
      setBlocked(error.message);
      return;
    }
    toast.error(errorText(error, fallback));
  };

  const loadShortlist = useCallback(async () => {
    try {
      setShortlist(await api<Saved[]>('/creators/shortlist'));
    } catch (error) {
      if (!isApiError(error, 'FEATURE_DISABLED')) toast.error(errorText(error, 'Could not load your shortlist.'));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await api<{ configured: boolean }>('/ai/status');
        setAiReady(status.configured);
      } catch { setAiReady(false); }
      await loadShortlist();
    })();
  }, [loadShortlist]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, chatting]);

  const runSearch = async (next: Partial<Criteria>) => {
    setSearching(true);
    setNotice('');
    try {
      const res = await api<{ creators: Creator[]; source: 'live' | 'sample'; notice?: string }>('/creators/search', {
        method: 'POST',
        body: JSON.stringify({ criteria: next, limit: 5 }),
      });
      setCreators(res.creators);
      setSource(res.source);
      setNotice(res.notice || '');
      setSearched(true);
    } catch (error) { fail(error, 'Could not search creators.'); }
    finally { setSearching(false); }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || chatting) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setDraft('');
    setChatting(true);
    try {
      const res = await api<{ reply: string; criteria: Criteria; ready_to_search: boolean; missing: string[] }>('/creators/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: next }),
      });
      setMessages([...next, { role: 'assistant' as const, content: res.reply }]);
      setCriteria(res.criteria);
      if (res.ready_to_search) await runSearch(res.criteria);
    } catch (error) { fail(error, 'Could not get an answer.'); }
    finally { setChatting(false); }
  };

  const manualSearch = (event: FormEvent) => {
    event.preventDefault();
    const next: Partial<Criteria> = {
      query: filters.query.trim() || undefined,
      creatorCountries: filters.country.trim() ? [filters.country.trim().toUpperCase()] : [],
      creatorMinFollowers: filters.minFollowers ? Number(filters.minFollowers) : undefined,
      creatorInterests: filters.interest ? [filters.interest] : [],
    };
    setCriteria({ ...(criteria || { creatorCountries: [], creatorInterests: [], majorAudienceCountries: [], similarTo: [] }), ...next } as Criteria);
    runSearch(next);
  };

  const save = async (creator: Creator) => {
    const handle = creator.username.replace(/^@/, '');
    setSaving(handle);
    try {
      await api('/creators/shortlist', { method: 'POST', body: JSON.stringify(creator) });
      toast.success(`@${handle} saved to your shortlist`);
      await loadShortlist();
    } catch (error) { fail(error, 'Could not save this creator.'); }
    finally { setSaving(null); }
  };

  const remove = async (id: string, username: string) => {
    try {
      await api(`/creators/shortlist/${id}`, { method: 'DELETE' });
      toast.success(`@${username} removed`, { action: { label: 'Undo', onClick: () => loadShortlist() } });
      setShortlist((cur) => cur.filter((s) => s.id !== id));
    } catch (error) { fail(error, 'Could not remove this creator.'); }
  };

  const savedNames = new Set(shortlist.map((s) => s.username));
  const summary = criteria ? [criteria.query, ...criteria.creatorCountries, criteria.creatorMinFollowers ? `${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(criteria.creatorMinFollowers)}+ followers` : null].filter(Boolean) as string[] : [];

  return (
    <div>
      <section className="page-intro">
        <div><div className="eyebrow">Partnerships</div><h1>Creators</h1><p>Describe who you need in the chat. Motion asks a few questions, then shows the top 5 matching Instagram creators.</p></div>
        <div className="page-intro-actions">
          {source && <span className={source === 'live' ? 'live-pill' : 'status-pill status-draft'}>{source === 'live' && <i aria-hidden="true" />}{source === 'live' ? 'Live results' : 'Sample results'}</span>}
          <span className="list-count">{shortlist.length} saved</span>
        </div>
      </section>

      {blocked && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {blocked}</div>}
      {!aiReady && !blocked && <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> AI chat is not set up yet. Add OPENROUTER_API_KEY to backend/.env and restart the backend. Manual search below still works.</div>}
      {notice && <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> {notice}</div>}

      <div className="split-layout">
        <section className="card" aria-label="Creator finder chat">
          <div className="card-header">
            <div><h2 className="card-title"><Icon name="sparkles" size={15} /> What are you looking for?</h2>
              <p className="card-subtitle">Answer a few basics. The search runs itself once it has enough.</p></div>
          </div>
          {summary.length > 0 && <div className="creator-tags"><div className="tag-row">{summary.map((s) => <span key={s} className="tag tag-brand">{s}</span>)}</div></div>}
          <div className="chat-log" role="log" aria-label="Conversation" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === 'user' ? 'chat-user' : 'chat-ai'}`}>{m.content}</div>
            ))}
            {chatting && <div className="chat-msg chat-ai"><span className="skeleton" style={{ display: 'inline-block', width: 120, height: 14 }} aria-hidden="true" /></div>}
            <div ref={bottomRef} />
          </div>
          <form className="chat-form" onSubmit={send}>
            <input aria-label="Message" placeholder={aiReady ? 'e.g. Fitness creators in India with 50K+ followers' : 'AI chat is off'} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} disabled={!aiReady || chatting} />
            <button className="btn btn-sm" type="submit" disabled={!aiReady || chatting || !draft.trim()} aria-label="Send message"><Icon name="send" size={14} /></button>
          </form>
        </section>

        <section className="stack" aria-label="Matching creators">
          <form className="lab-prompt" onSubmit={manualSearch} aria-label="Search creators directly">
            <span className="st-ai" aria-hidden="true">Top 5</span>
            <input aria-label="Niche or keywords" placeholder="Niche or keywords…" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} maxLength={200} />
            <Select aria-label="Creator country" className="lab-sel" value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })}>
              <option value="">Anywhere</option>{['IN', 'US', 'GB', 'BR', 'ES'].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select aria-label="Minimum followers" className="lab-sel" value={filters.minFollowers} onChange={(e) => setFilters({ ...filters, minFollowers: e.target.value })}>
              {FOLLOWERS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </Select>
            <Select aria-label="Interest" className="lab-sel" value={filters.interest} onChange={(e) => setFilters({ ...filters, interest: e.target.value })}>
              {INTERESTS.map((v) => <option key={v || 'any'} value={v}>{interestLabel(v)}</option>)}
            </Select>
            <button className="btn" type="submit" disabled={searching}><Icon name="search" size={15} className={searching ? 'spin' : ''} /> {searching ? 'Searching…' : 'Search'}</button>
          </form>

          {searching && (
            <div className="connection-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 190 }} />)}
            </div>
          )}
          {!searching && creators.map((c) => (
            <CreatorCard key={c.username} creator={c} saved={savedNames.has(c.username.replace(/^@/, ''))} saving={saving === c.username.replace(/^@/, '')} onSave={() => save(c)} />
          ))}
          {!searching && searched && creators.length === 0 && (
            <div className="empty-state"><strong>No creators matched</strong>Try a broader niche, another country, or a lower follower range.</div>
          )}
          {!searching && !searched && (
            <div className="empty-state"><strong>Your top 5 will appear here</strong>Answer the chat or run a manual search above.</div>
          )}
        </section>
      </div>

      {shortlist.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-label="Shortlist">
          <div className="card-header">
            <div><h2 className="card-title">Shortlist <span className="list-count">{shortlist.length}</span></h2>
              <p className="card-subtitle">Saved for this client workspace.</p></div>
          </div>
          <div className="rule-list">
            {shortlist.map((s) => (
              <div key={s.id} className="rule-list-item">
                <div className="comment-avatar" aria-hidden="true">{s.username.slice(0, 2).toUpperCase()}</div>
                <div className="rule-copy"><strong>@{s.username}</strong><span>{[s.country, typeof s.followers === 'number' ? `${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(s.followers)} followers` : null].filter(Boolean).join(' · ') || 'Saved creator'}</span></div>
                <div className="rule-list-actions">
                  <button className="icon-btn icon-btn-danger" type="button" onClick={() => remove(s.id, s.username)} aria-label={`Remove ${s.username}`}><Icon name="x" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
