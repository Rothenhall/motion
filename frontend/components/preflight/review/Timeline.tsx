'use client';

import { KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { plain } from '../../../lib/text';
import Filmstrip from './Filmstrip';
import FrameThumb from './FrameThumb';
import { LANES, fmtClock, momentInfo, nowReading, type FullSim, type VideoFacts } from './meta';
import type { Insight } from '../shared';

type Props = {
  sim: FullSim;
  video: VideoFacts | null;
  insights: Insight[];
  src: string;
  now: number;
  onSeek: (sec: number) => void;
  onPickMoment?: (index: number) => void;
  onPickInsight?: (index: number) => void;
  activeInsight?: number | null;
  /** Docked under the stage: shorter rows, and the explanation moves into a tooltip. */
  compact?: boolean;
  /** Whether the reel is playing, so the zoomed timeline can scroll along with it. */
  playing?: boolean;
};

const PX_PER_SEC = 34; // zoomed: each second of the reel gets this much width, and the timeline scrolls

const SEV_CLASS = { HIGH: 'bad', MEDIUM: 'warn', LOW: 'good' } as const;

/**
 * The reel laid out like an editing timeline: frames, predicted attention, where the fixes are, and what each part
 * of the brain was doing. Everything shares one time axis and one playhead, which you can click or drag.
 */
export default function Timeline({ sim, video, insights, src, now, onSeek, onPickMoment, onPickInsight, activeInsight, compact = false, playing = false }: Props) {
  const attention = sim.curves.attention_index ?? [];
  const n = attention.length;
  const duration = Math.max(video?.durationSec ?? 0, n > 1 ? n - 1 : 0, 1);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  const [signals, setSignals] = useState(false);
  const tracks = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverPx, setHoverPx] = useState(0);
  // Docked, the timeline starts zoomed and scrolls with the video; the toggle fits the whole reel to the width.
  const [zoom, setZoom] = useState(compact);
  const scroller = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const trackPx = zoom ? Math.round(duration * PX_PER_SEC) : null;

  // Fix bars that overlap in time go on separate lines so every one stays readable and clickable.
  const placed = useMemo(() => {
    const ends: number[] = [];
    return insights.map((ins, index) => {
      const start = ins.startSec ?? 0;
      const end = Math.max(ins.endSec ?? start + 1, start + 1);
      let lane = ends.findIndex((e) => e <= start);
      if (lane === -1) { lane = ends.length; ends.push(end); } else ends[lane] = end;
      return { ins, index, start, end, lane, timed: ins.startSec != null };
    }).filter((p) => p.timed);
  }, [insights]);
  const fixLanes = Math.max(1, ...placed.map((p) => p.lane + 1));

  const at = (clientX: number) => {
    const box = tracks.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    onSeek(Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration)));
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-hit]')) return; // markers handle their own click
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    at(e.clientX);
  };
  const timeAt = (clientX: number) => {
    const box = tracks.current?.getBoundingClientRect();
    return box && box.width ? Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration)) : 0;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) at(e.clientX);
    else if (e.pointerType === 'mouse') { setHover(timeAt(e.clientX)); setHoverPx(e.clientX - (tracks.current?.getBoundingClientRect().left ?? 0)); }
  };
  const up = (e: PointerEvent<HTMLDivElement>) => { dragging.current = false; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, now + step)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, now - step)); }
    else if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
    else if (e.key === 'End') { e.preventDefault(); onSeek(duration); }
  };

  const ticks = useMemo(() => {
    const every = zoom ? 2 : duration > 90 ? 15 : duration > 40 ? 10 : 5;
    const list: number[] = [];
    for (let t = 0; t <= duration; t += every) list.push(t);
    return list;
  }, [duration, zoom]);

  const rowH = compact
    ? { ruler: 18, frames: 38, attention: 78, fixes: fixLanes * 22 + 6, lane: 16 }
    : { ruler: 24, frames: 58, attention: 140, fixes: fixLanes * 26 + 10, lane: 22 };
  const curve = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${i} ${(100 - v).toFixed(2)}`).join(' ');
  const cuts = video?.cuts ?? [];
  const frameCount = Math.min(40, Math.max(8, Math.ceil(duration)));

  // Zoomed: keep the playhead in view. While playing it rides at about a third of the way across; after a manual scroll
  // it stays where the user put it for a moment; when paused it only moves if the playhead has left the window.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    if (!zoom) { sc.scrollLeft = 0; return; }
    const viewW = sc.clientWidth - 102;
    const x = now * PX_PER_SEC;
    const idle = Date.now() - lastUserScroll.current > 2500;
    if (playing && idle) sc.scrollLeft = Math.max(0, x - viewW * 0.35);
    else if (!playing && (x < sc.scrollLeft + 24 || x > sc.scrollLeft + viewW - 24)) sc.scrollLeft = Math.max(0, x - viewW * 0.4);
  }, [now, playing, zoom]);
  const markUserScroll = () => { lastUserScroll.current = Date.now(); };

  return (
    <section className="rr-card rr-tl" aria-labelledby="tl-title">
      <header className="rr-tl-head">
        <div>
          <h2 id="tl-title" className="rr-h">Timeline</h2>
          {!compact && <p className="rr-sub">Click or drag to scrub. The video, brain view and readout follow. Arrow keys step one second.</p>}
        </div>
        {compact && (
          <div className="rr-legend rr-legend-inline" aria-hidden="true">
            <span><i className="rr-key rr-key-line" /> With sound</span>
            {sim.sound_off_attention && <span><i className="rr-key rr-key-dash" /> Muted</span>}
            <span><i className="rr-key rr-key-bad" /> Drop-off</span>
            <span><i className="rr-key rr-key-warn" /> Text</span>
            <span><i className="rr-key rr-key-dot" /> Peak</span>
          </div>
        )}
        <div className="rr-tl-tools">
          {compact && (
            <div className="rr-zoomtog" role="group" aria-label="Timeline zoom">
              <button type="button" className={`toolbar-filter ${zoom ? 'active' : ''}`} aria-pressed={zoom} onClick={() => setZoom(true)}>Follow</button>
              <button type="button" className={`toolbar-filter ${!zoom ? 'active' : ''}`} aria-pressed={!zoom} onClick={() => setZoom(false)}>Fit whole reel</button>
            </div>
          )}
        <button type="button" className={`toolbar-filter ${signals ? 'active' : ''}`} aria-pressed={signals} onClick={() => setSignals((s) => !s)}>
          {signals ? 'Hide' : 'Show'} brain signals
        </button>
        </div>
      </header>

      <div className={`rr-tl-body ${zoom ? 'is-zoom' : ''}`} ref={scroller} onWheel={markUserScroll} onTouchMove={markUserScroll}>
        <div className="rr-labels" aria-hidden="true">
          <div style={{ height: rowH.ruler }} />
          <div className="rr-label" style={{ height: rowH.frames }}>Frames</div>
          <div className="rr-label" style={{ height: rowH.attention }}><b>Attention</b><small>50 is typical</small></div>
          <div className="rr-label" style={{ height: rowH.fixes }}>Fixes</div>
          {signals && LANES.map((l) => <div key={l.key} className="rr-label rr-label-sm" style={{ height: rowH.lane }} title={l.hint}>{l.label}</div>)}
        </div>

        <div
          className="rr-tracks"
          ref={tracks}
          style={trackPx ? { width: trackPx } : undefined}
          role="slider"
          tabIndex={0}
          aria-label="Reel timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(now)}
          aria-valuetext={`${fmtClock(now)} of ${fmtClock(duration)}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => setHover(null)}
          onKeyDown={key}
        >
          <div className="rr-ruler" style={{ height: rowH.ruler }}>
            {ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{fmtClock(t)}</span>)}
          </div>

          <div className="rr-row rr-frames" style={{ height: rowH.frames }}>
            {src && <Filmstrip src={src} duration={duration} count={frameCount} />}
            {cuts.map((c) => <i key={c} className="rr-cut" style={{ left: pct(c) }} title={`Cut at ${fmtClock(c)}`} />)}
          </div>

          <div className="rr-row rr-attn" style={{ height: rowH.attention }}>
            <div className="rr-zone rr-zone-hook" style={{ left: 0, width: pct(Math.min(3, duration)) }}><span>Hook</span></div>
            {sim.moments.map((m, i) => {
              const info = momentInfo(m.kind);
              if (m.kind === 'peak') return null;
              return (
                <button key={i} type="button" data-hit className={`rr-zone rr-zone-${info.tone}`} style={{ left: pct(m.start), width: `calc(${pct(Math.max(1, m.end - m.start + 1))} )` }} onClick={() => { onSeek(m.start); onPickMoment?.(i); }} aria-label={`${info.label}, ${fmtClock(m.start)} to ${fmtClock(m.end)}`} title={`${info.label} · ${fmtClock(m.start)}–${fmtClock(m.end)}`}>
                  <span>{info.label}</span>
                </button>
              );
            })}
            <i className="rr-mid" aria-hidden="true" />
            {n > 1 && (
              <svg className="rr-curve" viewBox={`0 0 ${duration} 100`} preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id="rr-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
                <path d={`${curve(attention)} V100 H0Z`} fill="url(#rr-fill)" />
                {sim.sound_off_attention && <path className="rr-curve-muted" d={curve(sim.sound_off_attention)} />}
                <path className="rr-curve-main" d={curve(attention)} />
              </svg>
            )}
            {sim.moments.map((m, i) => m.kind === 'peak' && (
              <button key={`p${i}`} type="button" data-hit className="rr-peak" style={{ left: pct((m.start + m.end) / 2 + 0.5), top: `${100 - m.level}%` }} onClick={() => { onSeek(m.start); onPickMoment?.(i); }} aria-label={`Attention peak at ${fmtClock(m.start)}`} title={`Attention peak · ${fmtClock(m.start)}`} />
            ))}
          </div>

          <div className="rr-row rr-fixrow" style={{ height: rowH.fixes }}>
            {placed.map((p) => (
              <button key={p.index} type="button" data-hit className={`rr-fix rr-fix-${SEV_CLASS[p.ins.severity]} ${activeInsight === p.index ? 'on' : ''}`} style={{ left: pct(p.start), width: pct(Math.max(1.2, p.end - p.start)), top: (compact ? 3 : 5) + p.lane * (compact ? 22 : 26) }} onClick={() => { onSeek(p.start); onPickInsight?.(p.index); }} title={`${plain(p.ins.title)} · ${fmtClock(p.start)}`} aria-label={`${plain(p.ins.title)}, ${fmtClock(p.start)}`}>
                <span>{plain(p.ins.title)}</span>
              </button>
            ))}
            {!placed.length && <span className="rr-empty-row">No timed fixes</span>}
          </div>

          {signals && LANES.map((l) => {
            const values = sim.curves[l.key] ?? [];
            const lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 1;
            return (
              <div key={l.key} className="rr-row rr-lane" style={{ height: rowH.lane }}>
                {values.map((v, i) => <i key={i} style={{ left: pct(i), width: pct(1), opacity: 0.1 + 0.9 * ((v - lo) / range) }} title={`${l.label} at ${fmtClock(i)}: ${Math.round(v)}`} />)}
              </div>
            );
          })}

          {hover != null && (() => {
            const r = nowReading(sim, hover);
            const sc = scroller.current;
            const tipLeft = zoom && sc ? Math.max(sc.scrollLeft + 70, Math.min(sc.scrollLeft + sc.clientWidth - 102 - 70, hoverPx)) : `clamp(70px, ${(hover / duration) * 100}%, calc(100% - 70px))`;
            return (
              <>
                <i className="rr-hoverline" style={{ left: pct(hover) }} aria-hidden="true" />
                <div className="rr-tip" style={{ left: tipLeft, top: rowH.ruler + rowH.frames + 8 }} aria-hidden="true">
                  {src && <FrameThumb src={src} time={Math.round(hover * 2) / 2} width={54} height={96} />}
                  <div>
                    <b>{fmtClock(hover)}</b>
                    {r.attention != null && <span>Attention {Math.round(r.attention)}</span>}
                    {r.moment && <span className="rr-tip-m">{momentInfo(r.moment.kind).label}</span>}
                    <em>{r.drivers.length ? r.drivers.join(', ') : 'Nothing stands out'}</em>
                  </div>
                </div>
              </>
            );
          })()}

          <div className="rr-playhead" style={{ left: pct(now) }} aria-hidden="true"><span>{fmtClock(now)}</span></div>
        </div>
      </div>

      {!compact && <footer className="rr-legend">
        <span><i className="rr-key rr-key-line" /> With sound</span>
        {sim.sound_off_attention && <span><i className="rr-key rr-key-dash" /> Muted autoplay</span>}
        <span><i className="rr-key rr-key-bad" /> Drop-off risk</span>
        <span><i className="rr-key rr-key-warn" /> Text overload</span>
        <span><i className="rr-key rr-key-dot" /> Attention peak</span>
        <span><i className="rr-key rr-key-cut" /> Scene cut</span>
      </footer>}
    </section>
  );
}
