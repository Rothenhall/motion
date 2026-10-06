'use client';

import { Select } from '@/components/ui/select';
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
const REPLY_MODE: Record<string, string> = { PUBLIC_AND_DM: 'reply publicly and send a DM', PUBLIC: 'reply publicly', DM: 'send a private DM' };

/** A rule read as one sentence, the same way the builder previews it. */
const sentence = (r: { trigger: string; keyword?: string | null; replyMode: string }) =>
  `${r.trigger === 'ALL_COMMENTS' ? 'When any comment arrives' : `When someone mentions “${r.keyword || 'a keyword'}”`}, ${REPLY_MODE[r.replyMode] || r.replyMode}.`;

export default function Automations() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const [form, setForm] = useState({ accountId: '', name: '', trigger: 'COMMENT_KEYWORD', keyword: '', replyMode: 'PUBLIC_AND_DM', publicReply: '', dmText: '' });
  const load = async () => { setLoading(true); try { const [accountData, ruleData] = await Promise.all([api('/accounts'), api('/automations')]); setAccounts(accountData || []); setRules(ruleData || []); } catch (error) { setLoadError(errorText(error, 'Could not load automations.')); } finally { setLoading(false); } };
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
  const hasPublic = form.replyMode === 'PUBLIC' || form.replyMode === 'PUBLIC_AND_DM';
  const hasDm = form.replyMode === 'DM' || form.replyMode === 'PUBLIC_AND_DM';

  return <div className="au">
    <section className="page-intro">
      <div><div className="eyebrow">Engagement engine</div><h1>Automations</h1><p>Turn high-intent comments into thoughtful conversations, automatically.</p></div>
      <div className="page-intro-actions"><span className={activeCount ? 'live-pill' : 'status-pill status-draft'}>{activeCount > 0 && <i aria-hidden="true" />}{activeCount} rule{activeCount === 1 ? '' : 's'} live</span></div>
    </section>
    {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}</div>}
    {confirmDialog}

    <div className="au-layout">
      <form className="au-builder" onSubmit={submit} aria-labelledby="builder-title">
        <div className="au-head"><h2 id="builder-title" className="ov-eyebrow">Build a rule</h2></div>

        <div className="au-step">
          <span className="au-tag">Where</span>
          <div className="au-body">
            <div className="field"><label className="field-label" htmlFor="automation-account">Channel</label><Select id="automation-account" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} required><option value="">Select a connected account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name || account.externalId} · {channel(account.provider)}</option>)}</Select></div>
            <div className="field"><label className="field-label" htmlFor="rule-name">Rule name</label><input id="rule-name" placeholder="e.g. Send the launch link" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={60} /></div>
          </div>
        </div>
        <div className="au-link" aria-hidden="true" />
        <div className="au-step">
          <span className="au-tag">When</span>
          <div className="au-body">
            <div className="field"><label className="field-label" htmlFor="trigger">Trigger</label><Select id="trigger" value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })}><option value="COMMENT_KEYWORD">A keyword is mentioned</option><option value="ALL_COMMENTS">Any comment arrives</option></Select></div>
            {form.trigger === 'COMMENT_KEYWORD' && <div className="field"><label className="field-label" htmlFor="keyword">Keyword or phrase</label><input id="keyword" placeholder="e.g. link, price, guide" value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} required /></div>}
          </div>
        </div>
        <div className="au-link" aria-hidden="true" />
        <div className="au-step">
          <span className="au-tag">Then</span>
          <div className="au-body">
            <div className="field"><label className="field-label" htmlFor="reply-mode">Action</label><Select id="reply-mode" value={form.replyMode} onChange={(event) => setForm({ ...form, replyMode: event.target.value })}><option value="PUBLIC_AND_DM">Reply + send DM</option><option value="PUBLIC">Reply publicly</option><option value="DM">Send a private DM</option></Select></div>
            {hasPublic && <div className="field"><label className="field-label" htmlFor="publicReply">Public reply</label><textarea id="publicReply" rows={2} placeholder="Thanks for asking, check your messages" value={form.publicReply} onChange={(event) => setForm({ ...form, publicReply: event.target.value })} /></div>}
            {hasDm && <div className="field"><label className="field-label" htmlFor="dmText">Private message</label><textarea id="dmText" rows={2} placeholder="Here is the link you asked for…" value={form.dmText} onChange={(event) => setForm({ ...form, dmText: event.target.value })} /></div>}
          </div>
        </div>

        <div className="au-preview" aria-live="polite">
          <span className="st-ai" aria-hidden="true">AI</span>
          <div>
            <b>{sentence(form)}</b>
            {(hasPublic && form.publicReply) || (hasDm && form.dmText) ? (
              <div className="au-bubbles">
                {hasPublic && form.publicReply && <div className="ib-msg me">{form.publicReply}</div>}
                {hasDm && form.dmText && <div className="ib-msg me au-dm"><small>Private message</small>{form.dmText}</div>}
              </div>
            ) : <span className="muted"> Add a message to see how it will look.</span>}
          </div>
        </div>
        <div className="form-actions"><button className="btn" type="submit" disabled={saving || loading || !accounts.length}><Icon name="plus" size={15} /> {saving ? 'Saving…' : 'Save automation'}</button>{!accounts.length && !loading && <span className="form-hint">Connect a channel first. <Link className="card-action" href="/connect">Connect</Link></span>}</div>
      </form>

      <section className="au-rules" aria-labelledby="rules-title">
        <div className="ov-tile-top"><h2 id="rules-title" className="ov-eyebrow">Your rules</h2><span className="list-count">{rules.length}</span></div>
        {loading && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} aria-hidden="true" />)}
        {rules.map((rule) => (
          <article className={`au-rule ${rule.isActive ? '' : 'off'}`} key={rule.id}>
            <div className="au-rule-top">
              <div className="rule-icon" aria-hidden="true"><Icon name="zap" size={16} /></div>
              <div className="au-rule-title"><strong>{rule.name}</strong><span>{channel(rule.account?.provider)}{rule.account?.name ? ` · ${rule.account.name}` : ''}</span></div>
              <span className={`status-pill ${rule.isActive ? 'status-active' : 'status-paused'}`} aria-hidden="true">{rule.isActive ? 'Live' : 'Paused'}</span>
              <Switch checked={rule.isActive} onCheckedChange={() => toggle(rule)} aria-label={rule.name} />
              <button className="icon-btn icon-btn-danger" type="button" onClick={() => remove(rule)} aria-label={`Delete ${rule.name}`}><Icon name="trash" size={14} /></button>
            </div>
            <p className="au-sentence">{sentence(rule)}</p>
            {(rule.publicReply || rule.dmText) && <div className="au-bubbles">{rule.publicReply && <div className="ib-msg me">{rule.publicReply}</div>}{rule.dmText && <div className="ib-msg me au-dm"><small>Private message</small>{rule.dmText}</div>}</div>}
          </article>
        ))}
        {!loading && rules.length === 0 && <div className="ov-empty"><strong>No automations yet</strong><p>Create your first rule and let Motion handle the repetitive replies.</p></div>}
      </section>
    </div>
  </div>;
}
