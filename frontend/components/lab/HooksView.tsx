'use client';

import { Select } from '@/components/ui/select';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../Icons';
import { api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { plain } from '@/lib/text';
import { useConfirm } from '../ConfirmDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Hook = { id: string; text: string; category: string; platform?: string | null; source: string; topic?: string | null; isFavorite: boolean; usedCount: number };

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'CURIOSITY', label: 'Curiosity' }, { id: 'CONTRARIAN', label: 'Contrarian' }, { id: 'STORY', label: 'Story' }, { id: 'LISTICLE', label: 'List' },
  { id: 'QUESTION', label: 'Question' }, { id: 'PROOF', label: 'Proof' }, { id: 'PAIN', label: 'Pain point' }, { id: 'HOW_TO', label: 'How to' },
];
const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
const SOURCE_LABEL: Record<string, string> = { SEED: 'Starter', AI: 'AI', CUSTOM: 'Yours' };

function categoryLabel(id: string) { return CATEGORIES.find((c) => c.id === id)?.label || id; }

export default function HooksView() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiReady, setAiReady] = useState(true);
  const [category, setCategory] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState({ topic: '', platform: '', category: '', count: 6 });
  const [custom, setCustom] = useState({ text: '', category: 'CURIOSITY' });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const fail = (error: unknown, fallback: string) => toast.error(errorText(error, fallback));

  const load = async () => {
    try { setHooks(await api<Hook[]>('/hooks')); }
    catch (error) { setLoadError(errorText(error, 'Could not load the hook library.')); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    api<{ configured: boolean }>('/ai/status').then((s) => setAiReady(s.configured)).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hooks.filter((h) => (!category || h.category === category) && (!favoritesOnly || h.isFavorite) && (!q || h.text.toLowerCase().includes(q) || (h.topic || '').toLowerCase().includes(q)));
  }, [hooks, category, favoritesOnly, query]);

  const generate = async (event: FormEvent) => {
    event.preventDefault(); setGenerating(true);
    try {
      const created = await api<Hook[]>('/hooks/generate', { method: 'POST', body: JSON.stringify({ ...request, platform: request.platform || undefined, category: request.category || undefined }) });
      setHooks((current) => [...created, ...current]);
      setCategory(''); setFavoritesOnly(false); setQuery('');
      toast.success(`${created.length} hooks written`, { description: request.topic });
    } catch (error) { fail(error, 'Could not write hooks.'); }
    finally { setGenerating(false); }
  };

  const addCustom = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const hook = await api<Hook>('/hooks', { method: 'POST', body: JSON.stringify(custom) });
      setHooks((current) => [hook, ...current]);
      setCustom({ ...custom, text: '' });
      toast.success('Hook added to your library');
    } catch (error) { fail(error, 'Could not add this hook.'); }
  };

  const copy = async (hook: Hook) => {
    try { await navigator.clipboard.writeText(hook.text); setCopied(hook.id); setTimeout(() => setCopied(''), 1500); }
    catch { toast.error('Your browser blocked copying. Select the text and copy it instead.'); return; }
    try {
      const updated = await api<Hook>(`/hooks/${hook.id}/use`, { method: 'POST' });
      setHooks((current) => current.map((h) => h.id === hook.id ? updated : h));
    } catch { /* usage count is best effort */ }
  };

  const favorite = async (hook: Hook) => {
    try {
      const updated = await api<Hook>(`/hooks/${hook.id}/favorite`, { method: 'PATCH' });
      setHooks((current) => current.map((h) => h.id === hook.id ? updated : h));
    } catch (error) { fail(error, 'Could not update this hook.'); }
  };

  const remove = async (hook: Hook) => {
    if (!(await confirm({ title: 'Remove this hook?', description: `“${hook.text}” will be deleted from your library.`, confirmLabel: 'Remove hook', destructive: true }))) return;
    try { await api(`/hooks/${hook.id}`, { method: 'DELETE' }); setHooks((current) => current.filter((h) => h.id !== hook.id)); }
    catch (error) { fail(error, 'Could not remove this hook.'); }
  };

  return <div>

    {!aiReady && <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> AI is not set up yet. Add OPENROUTER_API_KEY to backend/.env to write hooks for a topic. The starter library still works.</div>}
    {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}</div>}
    {confirmDialog}

    <div className="split-layout">
      <div className="stack">
        <section className="card form-card" aria-labelledby="write-title">
          <div className="card-header"><div><h2 className="card-title" id="write-title">Write hooks for a post</h2><p className="card-subtitle">Describe the post and get hooks in your brand voice.</p></div><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div>
          <form className="form-grid" onSubmit={generate}>
            <div className="field"><label className="field-label" htmlFor="hook-topic">What is the post about?</label><input id="hook-topic" placeholder="e.g. Why I stopped batch cooking on Sundays" value={request.topic} onChange={(e) => setRequest({ ...request, topic: e.target.value })} required maxLength={300} /></div>
            <div className="form-row">
              <div className="field"><label className="field-label" htmlFor="hook-platform">Platform</label><Select id="hook-platform" value={request.platform} onChange={(e) => setRequest({ ...request, platform: e.target.value })}><option value="">Any</option>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>
              <div className="field"><label className="field-label" htmlFor="hook-style">Style</label><Select id="hook-style" value={request.category} onChange={(e) => setRequest({ ...request, category: e.target.value })}><option value="">Mix of styles</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
            </div>
            <div className="form-actions"><button className="btn" type="submit" disabled={generating || !aiReady}><Icon name="sparkles" size={15} className={generating ? 'spin' : ''} /> {generating ? 'Writing…' : 'Write hooks'}</button></div>
          </form>
        </section>

        <section className="card form-card" aria-labelledby="add-title">
          <div className="card-header"><div><h2 className="card-title" id="add-title">Add your own</h2><p className="card-subtitle">Save a hook that worked so you can reuse its shape.</p></div></div>
          <form className="form-grid" onSubmit={addCustom}>
            <div className="field"><label className="field-label" htmlFor="custom-text">Hook</label><textarea id="custom-text" rows={2} placeholder="Use [brackets] for the parts you swap out" value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} required maxLength={280} /></div>
            <div className="field"><label className="field-label" htmlFor="custom-category">Style</label><Select id="custom-category" value={custom.category} onChange={(e) => setCustom({ ...custom, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
            <div className="form-actions"><button className="btn btn-ghost" type="submit"><Icon name="plus" size={15} /> Add to library</button></div>
          </form>
        </section>
      </div>

      <section className="card data-card" aria-labelledby="library-title">
        <div className="card-header"><div><h2 className="card-title" id="library-title">Library <span className="list-count">{visible.length}</span></h2><p className="card-subtitle">Copy a hook to use it. Swap the [bracketed] parts for your topic.</p></div></div>
        <div className="inbox-toolbar" role="group" aria-label="Filter hooks">
          <input className="hook-search" type="search" placeholder="Search hooks" aria-label="Search hooks" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className={`toolbar-filter ${favoritesOnly ? 'active' : ''}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}><Icon name="star" size={12} /> Favorites</button>
          <button type="button" className={`toolbar-filter ${!category ? 'active' : ''}`} aria-pressed={!category} onClick={() => setCategory('')}>All</button>
          {CATEGORIES.map((c) => <button key={c.id} type="button" className={`toolbar-filter ${category === c.id ? 'active' : ''}`} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</button>)}
        </div>
        <div className="rule-list">
          {loading && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          {!loading && visible.map((hook) => (
            <div className="rule-list-item hook-item" key={hook.id}>
              <button className={`icon-btn star-btn ${hook.isFavorite ? 'on' : ''}`} type="button" aria-pressed={hook.isFavorite} aria-label={hook.isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => favorite(hook)}><Icon name="star" size={14} /></button>
              <div className="rule-copy hook-copy">
                <strong>{plain(hook.text)}</strong>
                <span>{categoryLabel(hook.category)} · {SOURCE_LABEL[hook.source] || hook.source}{hook.platform ? ` · ${PLATFORMS.find((p) => p.id === hook.platform)?.label}` : ''}{hook.topic ? ` · ${hook.topic}` : ''}{hook.usedCount ? ` · used ${hook.usedCount}×` : ''}</span>
              </div>
              <div className="rule-list-actions">
                <button className="btn btn-sm btn-soft" type="button" onClick={() => copy(hook)}><Icon name={copied === hook.id ? 'check' : 'copy'} size={13} /> {copied === hook.id ? 'Copied' : 'Copy'}</button>
                <Tooltip>
                  <TooltipTrigger asChild><Link className="icon-btn" href={`/?compose=true&caption=${encodeURIComponent(hook.text)}`} aria-label="Start a post with this hook"><Icon name="send" size={14} /></Link></TooltipTrigger>
                  <TooltipContent>Start a post</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild><button className="icon-btn icon-btn-danger" type="button" onClick={() => remove(hook)} aria-label="Remove hook"><Icon name="trash" size={14} /></button></TooltipTrigger>
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
          {!loading && visible.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="sparkles" size={18} /></div><strong>No hooks match</strong>Try another style, or write hooks for your next post.{(category || favoritesOnly || query) && <><br /><button className="card-action" type="button" onClick={() => { setCategory(''); setFavoritesOnly(false); setQuery(''); }}>Clear filters</button></>}</div>}
        </div>
      </section>
    </div>
  </div>;
}
