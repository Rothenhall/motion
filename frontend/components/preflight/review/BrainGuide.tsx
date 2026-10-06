'use client';

import { ATTENTION_EXPLAINER, brainNow, fmtClock, type FullSim } from './meta';

/** One plain sentence about the current second, shown under the brain so the picture always comes with its meaning. */
export function BrainCaption({ sim, now, onMore }: { sim: FullSim; now: number; onMore: () => void }) {
  const r = brainNow(sim, now);
  return (
    <div className="rrp-cap" aria-live="off">
      <p><b>At {fmtClock(now)}:</b> {r.sentence} <button type="button" className="rrp-cap-more" onClick={onMore}>What am I looking at?</button></p>
      <small className="rrp-cap-key"><span className="k-up">▲</span> above usual <span className="k-down">▼</span> below usual. Brighter colour = more active. Drag to turn.</small>
    </div>
  );
}

/** The full explanation: how to read the colours, which system is which, and what each means for the reel right now. */
export default function BrainGuide({ sim, now }: { sim: FullSim; now: number }) {
  const r = brainNow(sim, now);
  return (
    <div className="rr-panel">
      <p className="rr-lead">
        The colours on the brain show how strongly each part of the cortex is predicted to respond to this exact second of the reel, compared with that part&rsquo;s own average over the whole reel.
        Bright red and yellow means it is working harder than usual. Dark grey means no more than usual. Drag the brain to turn it.
      </p>

      <div className="rrb-now">
        <span className="rrb-now-t">At {fmtClock(now)}</span>
        <p>{r.sentence}</p>
        {r.attention != null && (
          <div className="rrb-att">
            <span>Overall attention</span>
            <i aria-hidden="true"><b style={{ width: `${r.attention}%` }} /><u style={{ left: '50%' }} /></i>
            <strong>{Math.round(r.attention)}</strong>
          </div>
        )}
      </div>

      <h3 className="rr-eyebrow">What each part is doing right now</h3>
      <ul className="rrb-list">
        {r.systems.map((s) => {
          const tone = s.delta >= 6 ? 'up' : s.delta <= -6 ? 'down' : 'flat';
          return (
            <li key={s.key} className={`rrb-row rrb-${tone}`}>
              <div className="rrb-top">
                <b>{s.label}</b>
                <span className="rrb-state">{tone === 'up' ? 'Above usual' : tone === 'down' ? 'Below usual' : 'Typical'}</span>
              </div>
              <i className="rrb-bar" aria-hidden="true"><b style={{ width: `${Math.max(2, Math.min(100, s.value))}%` }} /><u style={{ left: `${Math.max(0, Math.min(100, s.mean))}%` }} /></i>
              <p>{s.means}</p>
              <small>{s.area}</small>
            </li>
          );
        })}
      </ul>
      <p className="rrb-key"><u /> marks this part&rsquo;s average over the reel. A bar past it is above usual at this second.</p>

      <details className="rr-keep">
        <summary>How the attention number is made</summary>
        <p className="rr-lead" style={{ marginTop: 10 }}>{ATTENTION_EXPLAINER}</p>
      </details>
      <details className="rr-keep">
        <summary>What to keep in mind</summary>
        <ul className="rrb-notes">
          <li>This is a model of an <b>average viewer&rsquo;s</b> brain, trained on brain scans of people watching video. It is not a measurement of your actual audience.</li>
          <li>The brain areas are a coarse, literature-based grouping, so treat each label as an approximation.</li>
          <li>It is most useful for comparing versions of the same reel and for spotting the seconds where attention rises or sags.</li>
        </ul>
      </details>
    </div>
  );
}
