'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';
import { errorText, platformName } from '../../lib/format';
import { useConfirm } from '../../components/ConfirmDialog';
import { Switch } from '@/components/ui/switch';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Rule = { id: string; name: string; trigger: string; keyword?: string | null; replyMode: string; publicReply?: string | null; dmText?: string | null; isActive: boolean; account?: Account };

const channel = (provider?: string) => platformName(provider || 'instagram');
const REPLY_MODE: Record<string, string> = { PUBLIC_AND_DM: 'Reply + DM', PUBLIC: 'Public reply', DM: 'Private DM' };

export default function Automations() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const [form, setForm] = useState({ accountId: '', name: '', trigger: 'COMMENT_KEYWORD', keyword: '', replyMode: 'PUBLIC_AND_DM', publicReply: '', dmText: '' });
  const load = async () => { setLoading(true); try { const [accountData, ruleData] = await Promise.all([api('/accounts'), api('/automations')]); setAccounts(accountData); setRules(ruleData); } catch (error) { setLoadError(errorText(error, 'Could not load automations.')); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await api('/automations', { method: 'POST', body: JSON.stringify(form) }); setForm({ ...form, name: '', keyword: '', publicReply: '', dmText: '' }); toast.success('Rule saved and live', { description: form.name }); await load(); }
    catch (error) { toast.error(errorText(error, 'Could not save this rule.')); }
    finally { setSaving(false); }
  };
  // Optimistic: flip right away, roll back if the server says no.
  const toggle = async (rule: Rule) => {
    const flip = (current: Rule[]) => current.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    setRules(flip);
    try {
      await api(`/automations/${rule.id}/toggle`, { method: 'PATCH' });
      toast(rule.isActive ? `Paused “${rule.name}”` : `“${rule.name}” is live`);
    } catch (error) {
      setRules(flip);
      toast.error(errorText(error, 'Could not change this rule.'));
    }
  };
  const remove = async (rule: Rule) => {
    if (!(await confirm({ title: `Delete “${rule.name}”?`, description: 'Motion stops replying to comments for this rule. This can’t be undone.', confirmLabel: 'Delete rule', destructive: true }))) return;
    try {
      await api(`/automations/${rule.id}`, { method: 'DELETE' });
      setRules((current) => current.filter((r) => r.id !== rule.id));
      toast.success('Rule deleted');
    } catch (error) { toast.error(errorText(error, 'Could not delete this rule.')); }
  };

  const activeCount = rules.filter((rule) => rule.isActive).length;

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Engagement engine</div><h1>Automations</h1><p>Turn high-intent comments into thoughtful conversations, automatically.</p></div>
      <div className="page-intro-actions"><span className={activeCount ? 'live-pill' : 'status-pill status-draft'}>{activeCount > 0 && <i aria-hidden="true" />}{activeCount} rule{activeCount === 1 ? '' : 's'} live</span></div>
    </section>
    {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}</div>}
    {confirmDialog}
    <div className="split-layout">
      <section className="card rule-builder" aria-labelledby="builder-title">
        <div className="card-header"><div><h2 className="card-title" id="builder-title">Build a new rule</h2><p className="card-subtitle">Choose a trigger and Motion will take care of the next step.</p></div><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div>
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
          <div className="form-actions"><button className="btn" type="submit" disabled={saving || loading || !accounts.length}><Icon name="plus" size={15} /> {saving ? 'Saving…' : 'Save automation'}</button>{!accounts.length && !loading && <span className="form-hint">Connect a channel first. <Link className="card-action" href="/connect">Connect</Link></span>}</div>
        </form>
      </section>
      <section className="card data-card" aria-labelledby="rules-title">
        <div className="card-header"><div><h2 className="card-title" id="rules-title">Your rules <span className="list-count">{rules.length}</span></h2><p className="card-subtitle">Keep the conversations moving while you focus on the bigger picture.</p></div></div>
        <div className="rule-list">
          {loading && [0, 1].map((i) => <div key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          {rules.map((rule) => (
            <div className="rule-list-item" key={rule.id}>
              <div className="rule-icon" aria-hidden="true"><Icon name="zap" size={16} /></div>
              <div className="rule-copy"><strong>{rule.name}</strong><span>{rule.trigger === 'ALL_COMMENTS' ? 'All comments' : `\u201C${rule.keyword || 'keyword'}\u201D`} · {REPLY_MODE[rule.replyMode] || rule.replyMode} · {channel(rule.account?.provider)}</span></div>
              <div className="rule-list-actions">
                <span className={`status-pill ${rule.isActive ? 'status-active' : 'status-paused'}`} aria-hidden="true">{rule.isActive ? 'Live' : 'Paused'}</span>
                <Switch checked={rule.isActive} onCheckedChange={() => toggle(rule)} aria-label={rule.name} />
                <button className="icon-btn icon-btn-danger" type="button" onClick={() => remove(rule)} aria-label={`Delete ${rule.name}`}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
          {!loading && rules.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="zap" size={18} /></div><strong>No automations yet</strong>Create your first rule and let Motion handle the repetitive replies.</div>}
        </div>
      </section>
    </div>
  </div>;
}
