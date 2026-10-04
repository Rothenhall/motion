'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Rule = { id: string; name: string; trigger: string; keyword?: string | null; replyMode: string; publicReply?: string | null; dmText?: string | null; isActive: boolean; account?: Account };

function channel(provider?: string) { return provider === 'facebook_page' ? 'Facebook' : provider === 'threads' ? 'Threads' : 'Instagram'; }

export default function Automations() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ accountId: '', name: '', trigger: 'COMMENT_KEYWORD', keyword: '', replyMode: 'PUBLIC_AND_DM', publicReply: '', dmText: '' });
  const load = async () => { setLoading(true); try { const [accountData, ruleData] = await Promise.all([api('/accounts'), api('/automations')]); setAccounts(accountData); setRules(ruleData); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load automations.'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setSaving(true);
    try { await api('/automations', { method: 'POST', body: JSON.stringify(form) }); setForm({ ...form, name: '', keyword: '', publicReply: '', dmText: '' }); setNotice('Automation saved and live.'); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save this rule.'); }
    finally { setSaving(false); }
  };
  const toggle = async (id: string) => { await api(`/automations/${id}/toggle`, { method: 'PATCH' }); setRules((current) => current.map((rule) => rule.id === id ? { ...rule, isActive: !rule.isActive } : rule)); };
  const remove = async (id: string, name: string) => { if (!window.confirm(`Delete "${name}"? This stops all automatic replies for this rule.`)) return; await api(`/automations/${id}`, { method: 'DELETE' }); setRules((current) => current.filter((rule) => rule.id !== id)); };

  const activeCount = rules.filter((rule) => rule.isActive).length;
  const isSuccess = /saved|live/i.test(notice);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Engagement engine</div><h2>Automations</h2><p>Turn high-intent comments into thoughtful conversations, automatically.</p></div>
      <div className="page-intro-actions"><span className="live-pill" role="status"><i aria-hidden="true" />{activeCount} rule{activeCount === 1 ? '' : 's'} active</span></div>
    </section>
    {notice && <div className={`notice ${isSuccess ? 'notice-success' : 'notice-error'}`} role="alert" aria-live="polite"><Icon name={isSuccess ? 'check' : 'alert'} size={15} /> {notice}</div>}
    <div className="split-layout">
      <section className="card rule-builder" aria-labelledby="builder-title">
        <div className="card-header"><div><h3 className="card-title" id="builder-title">Build a new rule</h3><p className="card-subtitle">Choose a trigger and Motion will take care of the next step.</p></div><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div>
        <form className="form-grid" onSubmit={submit}>
          <div className="field"><label className="field-label" htmlFor="automation-account">Channel</label><select id="automation-account" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} required><option value="">Select a connected account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name || account.externalId} · {channel(account.provider)}</option>)}</select></div>
          <div className="field"><label className="field-label" htmlFor="rule-name">Rule name</label><input id="rule-name" placeholder="e.g. Send the launch link" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={60} /></div>
          <div className="form-row">
            <div className="field"><label className="field-label" htmlFor="trigger">When</label><select id="trigger" value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })}><option value="COMMENT_KEYWORD">A keyword is mentioned</option><option value="ALL_COMMENTS">Any comment arrives</option></select></div>
            <div className="field"><label className="field-label" htmlFor="reply-mode">Then</label><select id="reply-mode" value={form.replyMode} onChange={(event) => setForm({ ...form, replyMode: event.target.value })}><option value="PUBLIC_AND_DM">Reply + send DM</option><option value="PUBLIC">Reply publicly</option><option value="DM">Send a private DM</option></select></div>
          </div>
          {form.trigger === 'COMMENT_KEYWORD' && <div className="field"><label className="field-label" htmlFor="keyword">Keyword or phrase</label><input id="keyword" placeholder="e.g. link, price, guide" value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} required /></div>}
          {(form.replyMode === 'PUBLIC' || form.replyMode === 'PUBLIC_AND_DM') && <div className="field"><label className="field-label" htmlFor="publicReply">Public reply</label><textarea id="publicReply" rows={2} placeholder="Thanks for asking — check your messages" value={form.publicReply} onChange={(event) => setForm({ ...form, publicReply: event.target.value })} /></div>}
          {(form.replyMode === 'DM' || form.replyMode === 'PUBLIC_AND_DM') && <div className="field"><label className="field-label" htmlFor="dmText">Private message</label><textarea id="dmText" rows={2} placeholder="Here is the link you asked for…" value={form.dmText} onChange={(event) => setForm({ ...form, dmText: event.target.value })} /></div>}
          <div className="rule-preview" aria-live="polite"><div className="rule-preview-label"><Icon name="sparkles" size={13} /> Rule preview</div><p>{form.trigger === 'ALL_COMMENTS' ? 'When any comment arrives' : `When someone mentions \u201C${form.keyword || 'your keyword'}\u201D`} — {form.replyMode === 'PUBLIC_AND_DM' ? 'reply publicly and send a DM' : form.replyMode === 'PUBLIC' ? 'reply publicly' : 'send a private DM'}.</p></div>
          <div className="form-actions"><button className="btn" type="submit" disabled={saving || loading || !accounts.length}><Icon name="plus" size={15} /> {saving ? 'Saving…' : 'Save automation'}</button>{!accounts.length && !loading && <span className="form-error">Connect an account first.</span>}</div>
        </form>
      </section>
      <section className="card data-card" aria-labelledby="rules-title">
        <div className="card-header"><div><h3 className="card-title" id="rules-title">Your rules <span className="list-count">{rules.length}</span></h3><p className="card-subtitle">Keep the conversations moving while you focus on the bigger picture.</p></div><button className="icon-btn" type="button" aria-label="Filter rules"><Icon name="filter" size={15} /></button></div>
        <div className="rule-list">
          {loading && <div className="empty-state" aria-busy="true">Loading your rules…</div>}
          {rules.map((rule) => (
            <div className="rule-list-item" key={rule.id}>
              <div className="rule-icon" aria-hidden="true"><Icon name="zap" size={16} /></div>
              <div className="rule-copy"><strong>{rule.name}</strong><span>{rule.trigger === 'ALL_COMMENTS' ? 'All comments' : `\u201C${rule.keyword || 'keyword'}\u201D`} · {rule.replyMode.replaceAll('_', ' + ').toLowerCase()} · {channel(rule.account?.provider)}</span></div>
              <div className="rule-list-actions">
                <span className={`status-pill ${rule.isActive ? 'status-active' : 'status-paused'}`}>{rule.isActive ? 'Live' : 'Paused'}</span>
                <button className={`toggle ${rule.isActive ? 'on' : ''}`} type="button" role="switch" aria-checked={rule.isActive} onClick={() => toggle(rule.id)} aria-label={`${rule.isActive ? 'Pause' : 'Activate'} ${rule.name}`}><span /></button>
                <button className="icon-btn" type="button" onClick={() => remove(rule.id, rule.name)} aria-label={`Delete ${rule.name}`}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
          {!loading && rules.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="zap" size={18} /></div><strong>No automations yet</strong>Create your first rule and let Motion handle the repetitive replies.</div>}
        </div>
      </section>
    </div>
  </div>;
}
