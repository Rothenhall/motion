'use client';

import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { errorText } from '@/lib/format';

export type Profile = { niche: string; audience?: string | null; voice?: string | null; pillars: string[]; platforms: string[]; autopilot: boolean; ideasPerRun: number };
const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
const blank = { niche: '', audience: '', voice: '', pillars: '', platforms: ['instagram'], autopilot: false, ideasPerRun: 5 };

/** The brand profile every idea is written against, in a side sheet so it stays out of the way of the board. */
export default function BrandSheet({ open, onOpenChange, profile, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; profile: Profile | null; onSaved: (profile: Profile) => void }) {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(profile ? { niche: profile.niche, audience: profile.audience || '', voice: profile.voice || '', pillars: profile.pillars.join(', '), platforms: profile.platforms, autopilot: profile.autopilot, ideasPerRun: profile.ideasPerRun } : blank);
  }, [open, profile]);

  const toggle = (id: string) => setForm((f) => ({ ...f, platforms: f.platforms.includes(id) ? f.platforms.filter((p) => p !== id) : [...f.platforms, id] }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const pillars = form.pillars.split(',').map((p) => p.trim()).filter(Boolean);
      const saved = await api<Profile>('/brand-profile', { method: 'PUT', body: JSON.stringify({ ...form, pillars }) });
      onSaved(saved || { ...form, pillars });
      onOpenChange(false);
      toast.success('Brand profile saved', { description: form.autopilot ? `Autopilot will add ${form.ideasPerRun} ideas every morning.` : undefined });
    } catch (error) { toast.error(errorText(error, 'Could not save your brand profile.')); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="st-drawer w-full sm:max-w-[460px] gap-0 p-0">
        <div className="st-drawer-head">
          <SheetTitle>Brand voice</SheetTitle>
          <SheetDescription>Every idea and hook is written against this, so it sounds like you.</SheetDescription>
        </div>
        <form className="st-drawer-body form-grid" onSubmit={save} id="brand-form">
          <div className="field"><label className="field-label" htmlFor="niche">What do you post about?</label><input id="niche" placeholder="e.g. Plant-based meal prep for busy parents" value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} required maxLength={200} /></div>
          <div className="field"><label className="field-label" htmlFor="audience">Who is it for?</label><input id="audience" placeholder="e.g. Working parents, 28 to 40, short on time" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} maxLength={200} /></div>
          <div className="field"><label className="field-label" htmlFor="voice">Voice</label><input id="voice" placeholder="e.g. Warm, practical, a little funny" value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} maxLength={200} /></div>
          <div className="field"><label className="field-label" htmlFor="pillars">Content pillars</label><input id="pillars" placeholder="Recipes, Shopping lists, Kid-friendly swaps" value={form.pillars} onChange={(e) => setForm({ ...form, pillars: e.target.value })} /><span className="form-hint">Separate with commas.</span></div>
          <fieldset className="field plain-fieldset"><legend className="field-label">Platforms</legend>
            <div className="tag-row">{PLATFORMS.map((p) => <button key={p.id} type="button" className={`toolbar-filter ${form.platforms.includes(p.id) ? 'active' : ''}`} aria-pressed={form.platforms.includes(p.id)} onClick={() => toggle(p.id)}>{p.label}</button>)}</div>
          </fieldset>
          <div className="autopilot-row">
            <Switch id="autopilot" checked={form.autopilot} aria-describedby="autopilot-hint" onCheckedChange={(autopilot) => setForm({ ...form, autopilot })} />
            <div><label htmlFor="autopilot"><strong>Autopilot</strong></label><small id="autopilot-hint">New ideas land on the board every morning at 7.</small></div>
            <Select aria-label="Ideas per morning" value={form.ideasPerRun} disabled={!form.autopilot} onChange={(e) => setForm({ ...form, ideasPerRun: Number(e.target.value) })}>{[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} / day</option>)}</Select>
          </div>
        </form>
        <div className="st-drawer-foot">
          <button className="btn" type="submit" form="brand-form" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
