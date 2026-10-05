'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Profile = { niche: string; audience?: string | null; voice?: string | null; pillars: string[]; platforms: string[]; autopilot: boolean; ideasPerRun: number; lastAutopilotAt?: string | null };
type Idea = { id: string; title: string; hook: string; angle?: string | null; format: string; platform: string; pillar?: string | null; caption?: string | null; hashtags: string[]; status: string; source: string; topic?: string | null; createdAt: string };
type Tab = 'NEW' | 'SAVED' | 'USED';

const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
const TABS: { id: Tab; label: string }[] = [{ id: 'NEW', label: 'Fresh' }, { id: 'SAVED', label: 'Saved' }, { id: 'USED', label: 'Used' }];
const emptyProfile = { niche: '', audience: '', voice: '', pillars: '', platforms: ['instagram'], autopilot: false, ideasPerRun: 5 };

function platformLabel(id: string) { return PLATFORMS.find((p) => p.id === id)?.label || id; }
function formatLabel(format: string) { return format.charAt(0) + format.slice(1).toLowerCase(); }
function postText(idea: Idea) { return [idea.caption || idea.hook, idea.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n'); }

export default function Ideas() {
  const [aiReady, setAiReady] = useState(true);
  const [profileForm, setProfileForm] = useState(emptyProfile);
  const [hasProfile, setHasProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [tab, setTab] = useState<Tab>('NEW');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [request, setRequest] = useState({ topic: '', platform: '', count: 5 });
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const fail = (error: unknown, fallback: string) => setNotice({ kind: 'error', text: error instanceof Error ? error.message : fallback });

  const loadIdeas = async (status: Tab = tab) => setIdeas(await api<Idea[]>(`/ideas?status=${status}`));

  useEffect(() => {
    (async () => {
      try {
        const [status, profile] = await Promise.all([api<{ configured: boolean }>('/ai/status'), api<Profile | null>('/brand-profile'), loadIdeas('NEW')]);
        setAiReady(status.configured);
        if (profile) {
          setHasProfile(true);
          setProfileForm({ niche: profile.niche, audience: profile.audience || '', voice: profile.voice || '', pillars: profile.pillars.join(', '), platforms: profile.platforms, autopilot: profile.autopilot, ideasPerRun: profile.ideasPerRun });
        } else setEditingProfile(true);
      } catch (error) { fail(error, 'Could not load ideas.'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = async (next: Tab) => {
    setTab(next);
    try { await loadIdeas(next); } catch (error) { fail(error, 'Could not load ideas.'); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setNotice(null); setSavingProfile(true);
    try {
      const pillars = profileForm.pillars.split(',').map((p) => p.trim()).filter(Boolean);
      await api('/brand-profile', { method: 'PUT', body: JSON.stringify({ ...profileForm, pillars }) });
      setHasProfile(true); setEditingProfile(false);
      setNotice({ kind: 'success', text: profileForm.autopilot ? `Brand profile saved. Autopilot will add ${profileForm.ideasPerRun} ideas every morning.` : 'Brand profile saved.' });
    } catch (error) { fail(error, 'Could not save your brand profile.'); }
    finally { setSavingProfile(false); }
  };

  const togglePlatform = (id: string) => setProfileForm((form) => ({
    ...form,
    platforms: form.platforms.includes(id) ? form.platforms.filter((p) => p !== id) : [...form.platforms, id],
  }));

  const generate = async (event: FormEvent) => {
    event.preventDefault(); setNotice(null); setGenerating(true);
    try {
      const created = await api<Idea[]>('/ideas/generate', { method: 'POST', body: JSON.stringify({ ...request, platform: request.platform || undefined }) });
      setTab('NEW');
      await loadIdeas('NEW');
      setNotice({ kind: 'success', text: `${created.length} new idea${created.length === 1 ? '' : 's'} added.` });
    } catch (error) { fail(error, 'Could not generate ideas.'); }
    finally { setGenerating(false); }
  };

  const setStatus = async (idea: Idea, status: string) => {
    try {
      await api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setIdeas((current) => current.filter((i) => i.id !== idea.id));
    } catch (error) { fail(error, 'Could not update this idea.'); }
  };

  const useInPost = async (idea: Idea) => {
    try { await api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'USED' }) }); } catch { /* still open the composer */ }
    window.location.assign(`/?compose=true&caption=${encodeURIComponent(postText(idea))}`);
  };

  const autopilotOn = hasProfile && profileForm.autopilot;

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Content engine</div><h2>Content ideas</h2><p>Fresh post ideas written for your niche and voice, with hooks and captions ready to schedule.</p></div>
      <div className="page-intro-actions">
        <span className={autopilotOn ? 'live-pill' : 'status-pill status-draft'} role="status">{autopilotOn && <i aria-hidden="true" />}Autopilot {autopilotOn ? 'on' : 'off'}</span>
        <a className="btn btn-ghost" href="/hooks"><Icon name="sparkles" size={15} /> Hook library</a>
      </div>
    </section>

    {!aiReady && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> AI is not set up yet. Add OPENROUTER_API_KEY to backend/.env and restart the backend.</div>}
    {notice && <div className={`notice ${notice.kind === 'success' ? 'notice-success' : 'notice-error'}`} role="alert" aria-live="polite"><Icon name={notice.kind === 'success' ? 'check' : 'alert'} size={15} /> {notice.text}</div>}

    <div className="split-layout">
      <div className="stack">
        <section className="card form-card" aria-labelledby="profile-title">
          <div className="card-header">
            <div><h3 className="card-title" id="profile-title">Brand profile</h3><p className="card-subtitle">Motion uses this to keep every idea on-brand.</p></div>
            {hasProfile && !editingProfile && <button className="card-action" type="button" onClick={() => setEditingProfile(true)}>Edit</button>}
          </div>
          {loading && <div className="skeleton" style={{ height: 120 }} />}
          {!loading && !editingProfile && <div className="profile-summary">
            <p><strong>{profileForm.niche}</strong></p>
            {profileForm.audience && <p>For {profileForm.audience}</p>}
            {profileForm.voice && <p>Voice: {profileForm.voice}</p>}
            {profileForm.pillars && <div className="tag-row">{profileForm.pillars.split(',').map((p) => p.trim()).filter(Boolean).map((p) => <span className="tag" key={p}>{p}</span>)}</div>}
            <p className="form-hint">{profileForm.platforms.map(platformLabel).join(', ')} · {profileForm.autopilot ? `${profileForm.ideasPerRun} ideas every morning` : 'Autopilot off'}</p>
          </div>}
          {!loading && editingProfile && <form className="form-grid" onSubmit={saveProfile}>
            <div className="field"><label className="field-label" htmlFor="niche">What do you post about?</label><input id="niche" placeholder="e.g. Plant-based meal prep for busy parents" value={profileForm.niche} onChange={(e) => setProfileForm({ ...profileForm, niche: e.target.value })} required maxLength={200} /></div>
            <div className="field"><label className="field-label" htmlFor="audience">Who is it for?</label><input id="audience" placeholder="e.g. Working parents, 28 to 40, short on time" value={profileForm.audience} onChange={(e) => setProfileForm({ ...profileForm, audience: e.target.value })} maxLength={200} /></div>
            <div className="field"><label className="field-label" htmlFor="voice">Voice</label><input id="voice" placeholder="e.g. Warm, practical, a little funny" value={profileForm.voice} onChange={(e) => setProfileForm({ ...profileForm, voice: e.target.value })} maxLength={200} /></div>
            <div className="field"><label className="field-label" htmlFor="pillars">Content pillars</label><input id="pillars" placeholder="Recipes, Shopping lists, Kid-friendly swaps" value={profileForm.pillars} onChange={(e) => setProfileForm({ ...profileForm, pillars: e.target.value })} /><span className="form-hint">Separate with commas.</span></div>
            <fieldset className="field plain-fieldset"><legend className="field-label">Platforms</legend>
              <div className="tag-row">{PLATFORMS.map((p) => <button key={p.id} type="button" className={`toolbar-filter ${profileForm.platforms.includes(p.id) ? 'active' : ''}`} aria-pressed={profileForm.platforms.includes(p.id)} onClick={() => togglePlatform(p.id)}>{p.label}</button>)}</div>
            </fieldset>
            <div className="autopilot-row">
              <button className={`toggle ${profileForm.autopilot ? 'on' : ''}`} type="button" role="switch" aria-checked={profileForm.autopilot} aria-labelledby="autopilot-label" onClick={() => setProfileForm({ ...profileForm, autopilot: !profileForm.autopilot })}><span /></button>
              <div><strong id="autopilot-label">Autopilot</strong><small>New ideas land here every morning at 7.</small></div>
              <select aria-label="Ideas per morning" value={profileForm.ideasPerRun} disabled={!profileForm.autopilot} onChange={(e) => setProfileForm({ ...profileForm, ideasPerRun: Number(e.target.value) })}>{[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} / day</option>)}</select>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
              {hasProfile && <button className="btn btn-ghost" type="button" onClick={() => setEditingProfile(false)}>Cancel</button>}
            </div>
          </form>}
        </section>

        <section className="card form-card" aria-labelledby="generate-title">
          <div className="card-header"><div><h3 className="card-title" id="generate-title">Generate ideas</h3><p className="card-subtitle">Leave the topic empty to get a mix across your pillars.</p></div><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div>
          <form className="form-grid" onSubmit={generate}>
            <div className="field"><label className="field-label" htmlFor="topic">Topic or campaign (optional)</label><input id="topic" placeholder="e.g. Back to school week" value={request.topic} onChange={(e) => setRequest({ ...request, topic: e.target.value })} maxLength={300} /></div>
            <div className="form-row">
              <div className="field"><label className="field-label" htmlFor="idea-platform">Platform</label><select id="idea-platform" value={request.platform} onChange={(e) => setRequest({ ...request, platform: e.target.value })}><option value="">All my platforms</option>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
              <div className="field"><label className="field-label" htmlFor="idea-count">How many</label><select id="idea-count" value={request.count} onChange={(e) => setRequest({ ...request, count: Number(e.target.value) })}>{[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} ideas</option>)}</select></div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={generating || !hasProfile || !aiReady}><Icon name="sparkles" size={15} className={generating ? 'spin' : ''} /> {generating ? 'Thinking…' : 'Generate ideas'}</button>
              {!hasProfile && !loading && <span className="form-hint">Save your brand profile first.</span>}
            </div>
          </form>
        </section>
      </div>

      <section className="card data-card" aria-labelledby="ideas-title">
        <div className="card-header"><div><h3 className="card-title" id="ideas-title">Your ideas <span className="list-count">{ideas.length}</span></h3><p className="card-subtitle">Save the keepers, send one to the composer, dismiss the rest.</p></div></div>
        <div className="inbox-toolbar" role="tablist" aria-label="Idea status">
          {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`toolbar-filter ${tab === t.id ? 'active' : ''}`} onClick={() => switchTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="idea-list">
          {loading && <div className="empty-state" aria-busy="true">Loading ideas…</div>}
          {!loading && ideas.map((idea) => (
            <article className="idea-card" key={idea.id}>
              <div className="idea-meta">
                <span className="tag">{platformLabel(idea.platform)}</span>
                <span className="tag">{formatLabel(idea.format)}</span>
                {idea.pillar && <span className="tag tag-muted">{idea.pillar}</span>}
                {idea.source === 'AUTOPILOT' && <span className="tag tag-brand">Autopilot</span>}
              </div>
              <h4>{idea.title}</h4>
              <p className="idea-hook">&ldquo;{idea.hook}&rdquo;</p>
              {idea.angle && <p className="idea-angle">{idea.angle}</p>}
              {idea.caption && <details className="idea-caption"><summary>Caption draft</summary><p>{idea.caption}</p>{idea.hashtags.length > 0 && <p className="idea-tags">{idea.hashtags.map((h) => `#${h}`).join(' ')}</p>}</details>}
              <div className="idea-actions">
                <button className="btn btn-sm" type="button" onClick={() => useInPost(idea)}><Icon name="send" size={13} /> Use in post</button>
                {idea.status !== 'SAVED' && <button className="btn btn-sm btn-soft" type="button" onClick={() => setStatus(idea, 'SAVED')}><Icon name="star" size={13} /> Save</button>}
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setStatus(idea, 'DISMISSED')} aria-label={`Dismiss ${idea.title}`}><Icon name="x" size={13} /> Dismiss</button>
              </div>
            </article>
          ))}
          {!loading && ideas.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="bulb" size={18} /></div><strong>{tab === 'NEW' ? 'No fresh ideas yet' : tab === 'SAVED' ? 'Nothing saved yet' : 'No ideas used yet'}</strong>{tab === 'NEW' ? 'Generate a batch, or turn on autopilot to wake up to new ones.' : 'Ideas you keep will show up here.'}</div>}
        </div>
      </section>
    </div>
  </div>;
}
