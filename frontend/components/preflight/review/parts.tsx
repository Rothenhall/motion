'use client';

import { Icon } from '../../Icons';
import { plain } from '../../../lib/text';
import { BASIS_LABELS, RATING_LABELS, clock, span, type Check, type Insight } from '../shared';
import FrameThumb from './FrameThumb';
import { SCORE_INFO, band, videoOf, zWords, type FullSim } from './meta';

const SEV = { HIGH: { label: 'Fix first', tone: 'bad' }, MEDIUM: { label: 'Worth fixing', tone: 'warn' }, LOW: { label: 'Working', tone: 'good' } } as const;

/** One finding: what is wrong, the frame it is about, and the fix, with a tick to mark it done. */
export function FixCard({ insight: i, id, active, nowPlaying, done, onToggle, onSeek, frame, big }: { insight: Insight; id: string; active: boolean; nowPlaying?: boolean; done?: boolean; onToggle?: () => void; onSeek?: (s: number) => void; frame?: { src: string; time: number; w: number; h: number }; big?: boolean }) {
  const sev = SEV[i.severity];
  return (
    <li id={id} className={`rr-fix-card rr-tone-${sev.tone} ${active ? 'on' : ''} ${nowPlaying ? 'live' : ''} ${done ? 'is-done' : ''} ${big ? 'rr-fix-big' : ''}`}>
      {frame && <FrameThumb src={frame.src} time={frame.time} width={frame.w} height={frame.h} className="rr-fix-frame" />}
      <div className="rr-fix-body">
        <div className="rr-fix-top">
          {onToggle && <button type="button" className={`pf-tick ${done ? 'on' : ''}`} role="checkbox" aria-checked={!!done} aria-label={`Mark fixed: ${i.title}`} onClick={onToggle}>{done && <Icon name="check" size={11} />}</button>}
          <span className={`st-chip ${sev.tone}`}>{sev.label}</span>
          {span(i) && (onSeek && i.startSec != null ? <button type="button" className="pf-time" onClick={() => onSeek(i.startSec!)} aria-label={`Play from ${clock(i.startSec)}`}><Icon name="play" size={11} /> {span(i)}</button> : <span className="pf-time">{span(i)}</span>)}
          {nowPlaying && <span className="rr-live">Playing now</span>}
          <span className="rr-basis">{BASIS_LABELS[i.basis] || i.basis}</span>
        </div>
        <strong className="rr-fix-title">{plain(i.title)}</strong>
        <p>{plain(i.detail)}</p>
        <p className="rr-fix-do"><b>{i.severity === 'LOW' ? 'Keep:' : 'Fix:'}</b> {plain(i.fix)}</p>
        {big && onSeek && i.startSec != null && <div className="rr-fix-cta"><button className="btn btn-sm" type="button" onClick={() => onSeek(i.startSec!)}><Icon name="play" size={12} /> Play this moment</button></div>}
      </div>
    </li>
  );
}

type Tone = 'good' | 'warn' | 'bad';

/** The reel in a few facts, flagged when one is likely to hurt (landscape video, no cuts, a late first face). */
export function factChips(check: Check, sim: FullSim | null): { label: string; tone?: Tone }[] {
  const v = videoOf(check);
  const out: { label: string; tone?: Tone }[] = [];
  if (v) {
    if (v.width && v.height) out.push({ label: `${v.width}×${v.height}`, tone: v.height > v.width ? 'good' : 'warn' });
    out.push({ label: `${v.durationSec.toFixed(1)}s` });
    if (v.cuts) out.push({ label: `${v.cuts.length} ${v.cuts.length === 1 ? 'cut' : 'cuts'}`, tone: v.cuts.length === 0 && v.durationSec > 12 ? 'warn' : undefined });
    if (v.hasAudio != null) out.push({ label: v.hasAudio ? 'Has sound' : 'No sound', tone: v.hasAudio ? undefined : 'warn' });
  }
  if (sim?.facts) {
    const f = sim.facts;
    if (f.first_face_second != null) out.push({ label: f.first_face_second <= 3 ? `Face at ${f.first_face_second}s` : `First face at ${f.first_face_second}s`, tone: f.first_face_second <= 3 ? 'good' : 'warn' });
    if (f.speech_seconds != null) out.push({ label: f.speech_seconds > 0 ? `${Math.round(f.speech_seconds)}s of speech` : 'No speech' });
  }
  return out;
}

/** The four numbers shown at the top, falling back to a count of strong and weak areas when there is no simulation. */
export function headlineTiles(check: Check, sim: FullSim | null) {
  const r = check.report!;
  const hook = Math.round(r.hook.score);
  const tiles: { label: string; value: string; pct: number; band: string; note: string }[] = [
    { label: 'Hook', value: String(hook), pct: hook, band: hook >= 60 ? 'good' : hook >= 40 ? 'mid' : 'low', note: RATING_LABELS[r.hook.rating] },
  ];
  const add = (key: string, label: string) => {
    const s = sim?.scores?.[key];
    if (!s) return;
    const lower = SCORE_INFO[key]?.lowerIsBetter;
    tiles.push({ label, value: String(Math.round(s.value)), pct: s.value, band: band(s.value, lower), note: zWords(s.z, lower).text });
  };
  add('hold', 'Hold'); add('ending', 'Ending'); add('sound_off_resilience', 'Sound off');
  if (tiles.length === 1) {
    const counts = { WEAK: 0, OK: 0, STRONG: 0 } as Record<string, number>;
    r.dimensions.forEach((d) => { counts[d.rating] += 1; });
    tiles.push({ label: 'Strong', value: String(counts.STRONG), pct: (counts.STRONG / Math.max(1, r.dimensions.length)) * 100, band: 'good', note: `of ${r.dimensions.length} areas` });
    tiles.push({ label: 'Weak', value: String(counts.WEAK), pct: (counts.WEAK / Math.max(1, r.dimensions.length)) * 100, band: counts.WEAK ? 'low' : 'good', note: `of ${r.dimensions.length} areas` });
  }
  return tiles;
}
