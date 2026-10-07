'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { FeatureMap, FeaturesPayload, getFeatures, saveFeatures } from '../../lib/admin';
import { errorText } from '../../lib/format';
import { ErrorNotice, SkeletonRows } from './Feedback';
import { featureCopy } from './feature-copy';
import { useLoad } from './hooks';
import type { ClientTabProps } from './types';

function Group({ title, keys, draft, saved, defaults, busy, onChange }: {
  title: string;
  keys: string[];
  draft: FeatureMap;
  saved: FeatureMap;
  defaults: FeatureMap;
  busy: boolean;
  onChange: (key: string, on: boolean) => void;
}) {
  if (!keys.length) return null;
  return (
    <section className="card" aria-labelledby={`group-${title}`}>
      <div className="card-header"><h2 className="card-title" id={`group-${title}`}>{title}</h2></div>
      <div className="adm-feature-group">
        {keys.map((key) => {
          const { label, hides } = featureCopy(key);
          const on = draft[key] ?? defaults[key] ?? true;
          const def = defaults[key] ?? true;
          const id = `feature-${key}`;
          return (
            <div className="adm-feature" key={key}>
              <div className="adm-feature-copy">
                <label htmlFor={id}>
                  {label}
                  {on !== def && <span className="adm-differs">Differs from default</span>}
                  {on !== (saved[key] ?? def) && <span className="adm-feature-meta"> (not saved)</span>}
                </label>
                <p>{hides}</p>
                <span className="adm-feature-meta">Default: {def ? 'on' : 'off'}. Now: {on ? 'on' : 'off'}.</span>
              </div>
              <Switch id={id} checked={on} disabled={busy} onCheckedChange={(next) => onChange(key, next)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * What this client can use. The server says which switches exist (sections and actions), so a new switch appears here
 * without a change to this screen.
 *
 * SLOT: another stream puts the "Require approval" toggle in `children`. It renders first, above the switches. To use it, wrap
 * this component where it is registered in tabs.ts, for example
 *   component: (p) => <FeaturesTab {...p}><RequireApprovalToggle client={p.client} reload={p.reload} /></FeaturesTab>
 */
export default function FeaturesTab({ client, children }: ClientTabProps & { children?: ReactNode }) {
  const loaded = useLoad<FeaturesPayload>(() => getFeatures(client.id), [client.id]);
  const [draft, setDraft] = useState<FeatureMap>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (loaded.data) setDraft({ ...loaded.data.features }); }, [loaded.data]);

  const data = loaded.data;
  const changes = useMemo(() => {
    const out: FeatureMap = {};
    if (!data) return out;
    for (const [key, value] of Object.entries(draft)) if (value !== data.features[key]) out[key] = value;
    return out;
  }, [draft, data]);
  const changed = Object.keys(changes).length;

  const groups = useMemo(() => {
    if (!data) return [];
    const listed = new Set([...data.groups.sections, ...data.groups.actions]);
    const other = Object.keys(data.defaults).filter((k) => !listed.has(k));
    return [
      { title: 'Sections', keys: data.groups.sections },
      { title: 'Actions', keys: data.groups.actions },
      { title: 'Other', keys: other },
    ];
  }, [data]);

  const save = async () => {
    if (!changed || busy) return;
    setBusy(true);
    try {
      loaded.setData(await saveFeatures(client.id, changes));
      toast.success('Features saved');
    } catch (e) {
      toast.error(errorText(e, 'Could not save the features.'));
    } finally {
      setBusy(false);
    }
  };

  if (loaded.error && !data) return <ErrorNotice message={loaded.error} onRetry={() => void loaded.reload()} busy={loaded.loading} />;
  if (!data) return <SkeletonRows count={4} label="Loading features" />;

  const atDefaults = Object.keys(data.defaults).every((k) => (draft[k] ?? data.defaults[k]) === data.defaults[k]);

  return (
    <div className="adm-panel">
      <div className="adm-slot" data-slot="require-approval">{children}</div>
      {groups.map((g) => (
        <Group key={g.title} title={g.title} keys={g.keys} draft={draft} saved={data.features} defaults={data.defaults} busy={busy} onChange={(key, on) => setDraft((d) => ({ ...d, [key]: on }))} />
      ))}
      <div className="adm-savebar">
        <button className="btn" type="button" onClick={() => void save()} disabled={!changed || busy}>{busy ? 'Saving…' : changed ? `Save ${changed} ${changed === 1 ? 'change' : 'changes'}` : 'Save'}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...draft, ...data.defaults })} disabled={atDefaults || busy}>Reset to defaults</button>
        <span className="form-hint" role="status" aria-live="polite">{changed ? 'You have changes that are not saved yet.' : ''}</span>
      </div>
    </div>
  );
}
