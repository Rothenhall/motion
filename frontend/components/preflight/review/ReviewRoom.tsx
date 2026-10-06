'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../Icons';
import { plain } from '../../../lib/text';
import { BrainPanel, Check, DIMENSION_LABELS, KIND_LABELS, PLATFORMS, RATING_LABELS, StatusPill, fixList, fixesAsText, saveHook, shortDate, span, type Insight } from '../shared';
import { mediaSrc } from '../../../lib/media';
import BrainGuide, { BrainCaption } from './BrainGuide';
import { releaseGrabber } from './frames';
import FrameThumb from './FrameThumb';
import { FixCard, factChips, headlineTiles } from './parts';
import Timeline from './Timeline';
import { SCORE_INFO, SCORE_ORDER, band, brainNow, fmtClock, momentInfo, nowReading, simOf, systemLabel, videoOf, zWords } from './meta';

type Tab = 'summary' | 'steps' | 'moments' | 'scores' | 'brain' | 'review';
const TAB_KEY = 'motion-review-tab-v2';
const FIT_MIN_WIDTH = 1300; // below this the workspace stacks and the page scrolls normally
const isTyping = (el: Element | null) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);

/**
 * A playground for one finished check. On a wide screen it fits the window with no page scroll: the reel and the brain
 * simulation side by side in the middle, the timeline docked underneath, and an inspector on the right that scrolls on
 * its own. Everything shares one playhead. On narrower screens the same pieces stack.
 */
export default function ReviewRoom({ check, onChanged, onDelete }: { check: Check; onChanged?: () => void; onDelete?: () => void }) {
  const r = check.report!;
  const sim = simOf(check);
  const vid = videoOf(check);
  const src = check.mediaUrls[0] ? mediaSrc(check.mediaUrls[0]) : '';
  const isReel = check.kind === 'VIDEO' && !!src;
  const portrait = !vid?.width || !vid?.height || vid.height >= vid.width;
  const playRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fitH, setFitH] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');
  const [activeFix, setActiveFix] = useState<number | null>(null);
  const [activeMoment, setActiveMoment] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const doneKey = `motion-fixes-${check.id}`;

  // Fit the workspace to the window: measure where it starts and give it the rest of the height.
  useEffect(() => {
    document.documentElement.classList.add('rr-fit');
    const measure = () => {
      const el = playRef.current;
      if (!el || window.innerWidth < FIT_MIN_WIDTH) { setFitH(null); return; }
      setFitH(Math.max(620, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 16)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    const settle = window.setTimeout(measure, 300); // after fonts and layout settle
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure); window.clearTimeout(settle); document.documentElement.classList.remove('rr-fit'); };
  }, []);

  // The hidden video that supplies the frames is only needed while this page is open.
  useEffect(() => () => { if (src) releaseGrabber(src); }, [src]);

  useEffect(() => { try { setDone(JSON.parse(window.localStorage.getItem(doneKey) || '{}')); } catch { setDone({}); } }, [doneKey]);
  useEffect(() => { try { const t = window.localStorage.getItem(TAB_KEY) as Tab | null; if (t) setTab(t); } catch { /* storage unavailable */ } }, []);
  const chooseTab = (t: Tab) => { setTab(t); try { window.localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ } };
  const toggleFix = (n: number) => setDone((cur) => {
    const next = { ...cur, [n]: !cur[n] };
    try { window.localStorage.setItem(doneKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });

  // Smooth playhead while playing; plain events when paused or scrubbing. The brain follows `now`.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const loop = () => { setNow(v.currentTime); raf = requestAnimationFrame(loop); };
    const onPlay = () => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); setNow(v.currentTime); };
    const onSeek = () => setNow(v.currentTime);
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause); v.addEventListener('ended', onPause); v.addEventListener('seeked', onSeek);
    return () => { cancelAnimationFrame(raf); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('ended', onPause); v.removeEventListener('seeked', onSeek); };
  }, [isReel]);

  const seek = useCallback((sec: number, play = false) => {
    const v = videoRef.current;
    setNow(sec);
    if (!v) return;
    v.currentTime = sec;
    if (play) v.play().catch(() => { /* autoplay blocked */ });
  }, []);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => { /* autoplay blocked */ }); else v.pause();
  }, []);

  const all = r.insights;
  const fixes = useMemo(() => fixList(r), [r]);
  const keeps = all.filter((i) => i.severity === 'LOW');
  const fixed = fixes.filter((_, n) => done[n]).length;
  const urgent = fixes.filter((i) => i.severity === 'HIGH').length;
  const moments = sim?.moments ?? [];
  const showMoments = !!sim && moments.length > 0;
  const showScores = !!sim?.scores;

  const goTo = (t: Tab, id?: string) => {
    chooseTab(t);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const pickFix = (allIndex: number) => { setActiveFix(allIndex); goTo('steps', `fix-${allIndex}`); };
  const pickMoment = (i: number) => { setActiveMoment(i); goTo('moments', `moment-${i}`); };

  // Keyboard: space plays, N and P jump between issues, arrows step a second (the timeline handles its own keys when focused).
  const issues = useMemo(() => fixes.map((i) => ({ i, idx: all.indexOf(i) })).filter(({ i }) => i.startSec != null).sort((a, b) => a.i.startSec! - b.i.startSec!), [fixes, all]);
  useEffect(() => {
    if (!isReel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      const el = document.activeElement as HTMLElement | null;
      const onBody = !el || el === document.body;
      const v = videoRef.current;
      if (e.key === ' ' && onBody && v) { e.preventDefault(); togglePlay(); }
      else if ((e.key === 'n' || e.key === 'p') && issues.length) {
        const t = videoRef.current?.currentTime ?? 0;
        const next = e.key === 'n' ? issues.find(({ i }) => i.startSec! > t + 0.4) ?? issues[0] : [...issues].reverse().find(({ i }) => i.startSec! < t - 0.4) ?? issues[issues.length - 1];
        seek(next.i.startSec!); setActiveFix(next.idx); goTo('steps', `fix-${next.idx}`);
      } else if (onBody && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && v) { e.preventDefault(); seek(Math.max(0, Math.min(v.duration || 0, v.currentTime + (e.key === 'ArrowRight' ? 1 : -1)))); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReel, issues, seek, togglePlay]);

  const copyFixes = () => { navigator.clipboard?.writeText(fixesAsText(r)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* clipboard blocked */ }); };
  const recheckHref = `/preflight?${new URLSearchParams([...check.mediaUrls.filter((u) => u.includes('/media/')).map((u) => ['media', u]), ['caption', check.caption || ''], ['platform', check.platform]]).toString()}`;

  const reading = sim && isReel ? nowReading(sim, now) : null;
  // Each system's state right now, printed on the brain as labels.
  const regions = useMemo(() => (sim && isReel ? brainNow(sim, now).systems.map((s) => ({ key: s.key, label: s.label, state: s.delta >= 6 ? 'up' as const : s.delta <= -6 ? 'down' as const : 'flat' as const })) : undefined), [sim, isReel, now]);
  const facts = factChips(check, sim);
  const headline = headlineTiles(check, sim);
  // In the stacked layout the stage is above the list, so jumping to a moment also brings the stage into view.
  const playFrom = (s: number) => { seek(s, true); if (!fitH) document.getElementById('rr-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const frame = { w: portrait ? 52 : 92, h: portrait ? 92 : 52 };
  const hero = fixes[0] ?? null;
  const rest = fixes.slice(1);
  const live = (i: Insight) => isReel && i.startSec != null && now >= i.startSec && now <= (i.endSec ?? i.startSec + 1.5);

  const tabs: { id: Tab; label: string; count?: number; show: boolean }[] = [
    { id: 'summary', label: 'Summary', show: true },
    { id: 'steps', label: 'Steps', count: fixes.length - fixed, show: true },
    { id: 'moments', label: 'Moments', count: moments.length, show: showMoments },
    { id: 'scores', label: 'Scores', show: showScores },
    { id: 'brain', label: 'Brain', show: !!sim && isReel },
    { id: 'review', label: 'Review', show: true },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : 'summary';

  const fixCard = (i: Insight, n: number, big = false) => {
    const idx = all.indexOf(i);
    return <FixCard key={`${idx}-${n}`} insight={i} id={`fix-${idx}`} active={activeFix === idx} nowPlaying={live(i)} done={!!done[n]} onToggle={() => toggleFix(n)}
      frame={isReel && i.startSec != null ? { src, time: i.startSec, w: big ? (portrait ? 68 : 120) : frame.w, h: big ? (portrait ? 120 : 68) : frame.h } : undefined}
      onSeek={isReel ? playFrom : undefined} big={big} />;
  };

  return (
    <div ref={playRef} className={`rrp ${fitH ? 'rrp-fit' : ''} ${isReel ? '' : 'rrp-noreel'}`} style={fitH ? ({ '--rrp-h': `${fitH}px` } as React.CSSProperties) : undefined}>
      {/* Top bar: where you are, the four numbers that matter, and what you can do */}
      <header className="rrp-bar">
        <Link className="btn btn-ghost btn-sm" href="/preflight"><Icon name="arrow-left" size={14} /> All checks</Link>
        <div className="rrp-title">
          <strong>{check.label || KIND_LABELS[check.kind]}</strong>
          <span>{PLATFORMS.find((p) => p.id === check.platform)?.label} {KIND_LABELS[check.kind].toLowerCase()} · checked {shortDate(check.createdAt)}</span>
        </div>
        <StatusPill check={check} />
        <div className="rrp-pills" role="list" aria-label="Headline scores">
          {headline.map((h) => (
            <button key={h.label} type="button" role="listitem" className={`rrp-pill rr-band-${h.band}`} onClick={() => goTo(showScores ? 'scores' : 'summary')} title={`${h.label}: ${h.note}`}>
              <i aria-hidden="true" /> <span>{h.label}</span> <b>{h.value}</b>
            </button>
          ))}
        </div>
        <div className="rrp-actions">
          <Link className="btn btn-sm" href={recheckHref}><Icon name="gauge" size={13} /> Check again</Link>
          {onDelete && <button className="icon-btn" type="button" aria-label="Delete check" onClick={onDelete}><Icon name="trash" size={13} /></button>}
        </div>
      </header>

      {/* Stage: the reel and the brain, side by side, playing in sync */}
      <section className="rrp-stage" id="rr-stage" aria-label={isReel ? 'Reel and brain response' : 'Your media'}>
        {isReel ? (
          <>
            <div className="rrp-stage-main">
              <div className={`rrp-video ${portrait ? 'is-portrait' : 'is-landscape'}`}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} src={`${src}#t=0.1`} controls playsInline preload="metadata" />
              </div>
              {sim && (
                <div className="rrp-brain">
                  <BrainPanel check={check} now={now} onChanged={onChanged} bare regions={regions} />
                  <BrainCaption sim={sim} now={now} onMore={() => goTo('brain')} />
                </div>
              )}
            </div>
            <div className="rrp-ready" aria-live="off">
              <button type="button" className="rrp-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
              <span className="rrp-time">{fmtClock(now)} <small>/ {fmtClock(vid?.durationSec ?? 0)}</small></span>
              {reading ? (
                <>
                  {reading.attention != null && <span className="rrp-att">Attention <b>{Math.round(reading.attention)}</b></span>}
                  {reading.moment && <span className={`st-chip ${momentInfo(reading.moment.kind).tone}`}>{momentInfo(reading.moment.kind).label}</span>}
                  <span className="rrp-drv">{reading.drivers.length ? `Driven by ${reading.drivers.join(' and ').toLowerCase()}` : 'Nothing stands out here'}</span>
                </>
              ) : null}
            </div>
          </>
        ) : check.mediaUrls.length > 0 ? (
          <div className="rr-images" aria-label="Your media">
            {check.mediaUrls.map((u, i) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={u} src={mediaSrc(u)} alt={check.kind === 'CAROUSEL' ? `Slide ${i + 1}` : 'Your image'} loading="lazy" />)}
          </div>
        ) : null}
      </section>

      {/* Dock: the timeline */}
      {sim && isReel && (
        <div className="rrp-dock">
          <Timeline compact playing={playing} sim={sim} video={vid} insights={all} src={src} now={now} onSeek={(s) => seek(s)} onPickMoment={pickMoment} onPickInsight={pickFix} activeInsight={activeFix} />
        </div>
      )}

      {/* Inspector: summary first, detail on demand, scrolls on its own */}
      <aside className="rrp-inspector" aria-label="Details">
        <div className="rr-tabs" role="tablist" aria-label="Review sections">
          {visibleTabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={activeTab === t.id} aria-controls={`panel-${t.id}`} className={`rr-tab ${activeTab === t.id ? 'on' : ''}`} onClick={() => chooseTab(t.id)}>
              {t.label}{t.count != null && t.count > 0 && <span className="rr-tab-n">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="rrp-body">
          {check.signals?.simulationError && <p className="form-hint">Audience simulation unavailable for this check ({check.signals.simulationError}). Insights come from the AI review.</p>}

          {/* Summary */}
          {activeTab === 'summary' && (
            <div role="tabpanel" id="panel-summary" aria-labelledby="tab-summary" className="rr-panel">
              <h2 className="rrs-verdict">{plain(r.verdict)}</h2>
              <p className="rrs-next">
                {urgent > 0 ? <b>{urgent} {urgent === 1 ? 'thing' : 'things'} to fix first. </b> : fixes.length ? <b>{fixes.length} worth fixing. </b> : <b>Nothing urgent. </b>}
                {keeps.length > 0 && <>{keeps.length} {keeps.length === 1 ? 'part is' : 'parts are'} already working.</>}
              </p>
              <div className="rrs-stats">
                {headline.map((h) => (
                  <button key={h.label} type="button" className={`rrs-stat rr-band-${h.band}`} onClick={() => goTo(showScores ? 'scores' : 'summary')}>
                    <span>{h.label}</span><strong>{h.value}</strong><i className="rr-meter" aria-hidden="true"><b style={{ width: `${h.pct}%` }} /></i><small>{h.note}</small>
                  </button>
                ))}
              </div>
              {facts.length > 0 && <ul className="rrs-facts" aria-label="About this reel">{facts.map((f) => <li key={f.label} className={f.tone ? `rrs-fact-${f.tone}` : ''}>{f.label}</li>)}</ul>}
              {hero && (
                <button type="button" className="rrs-start" onClick={() => goTo('steps', `fix-${all.indexOf(hero)}`)}>
                  {isReel && hero.startSec != null && <FrameThumb src={src} time={hero.startSec} width={portrait ? 48 : 84} height={portrait ? 84 : 48} className="rr-fix-frame" />}
                  <span className="rrs-start-copy"><em>Start here</em><b>{plain(hero.title)}</b><small>{span(hero) ? `${span(hero)} · ` : ''}Open the next steps</small></span>
                  <Icon name="arrow-right" size={14} />
                </button>
              )}
              {isReel && <p className="rr-keys" aria-label="Keyboard shortcuts"><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> step a second <kbd>N</kbd><kbd>P</kbd> next or previous issue</p>}
            </div>
          )}

          {/* Next steps */}
          {activeTab === 'steps' && (
            <div role="tabpanel" id="panel-steps" aria-labelledby="tab-steps" className="rr-panel">
              {fixes.length === 0 ? (
                <p className="rr-empty">Nothing needs fixing. Keep what is working and post it.</p>
              ) : (
                <>
                  <div className="rr-steps-bar">
                    <div><b>{fixed} of {fixes.length} fixed</b><span>Tick them off as you re-cut, then check the new version.</span></div>
                    <div className="rr-steps-actions">
                      <button className="btn btn-ghost btn-sm" type="button" onClick={copyFixes}><Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy list'}</button>
                      <Link className={`btn btn-sm ${fixed > 0 ? '' : 'btn-ghost'}`} href={recheckHref}><Icon name="gauge" size={13} /> Check again</Link>
                    </div>
                  </div>
                  <i className="rr-progress" aria-hidden="true"><b style={{ width: `${(fixed / fixes.length) * 100}%` }} /></i>
                  {hero && <><p className="rr-eyebrow">Start here</p><ul className="rr-fixes rr-fixes-hero">{fixCard(hero, 0, true)}</ul></>}
                  {rest.length > 0 && <><p className="rr-eyebrow">Then</p><ul className="rr-fixes">{rest.map((i, k) => fixCard(i, k + 1))}</ul></>}
                </>
              )}
              {keeps.length > 0 && (
                <details className="rr-keep" open={fixes.length === 0}>
                  <summary>Already working <span className="rr-tab-n">{keeps.length}</span></summary>
                  <ul className="rr-fixes">{keeps.map((i) => {
                    const idx = all.indexOf(i);
                    return <FixCard key={i.title} insight={i} id={`fix-${idx}`} active={activeFix === idx} nowPlaying={live(i)}
                      frame={isReel && i.startSec != null ? { src, time: i.startSec, w: frame.w, h: frame.h } : undefined} onSeek={isReel ? playFrom : undefined} />;
                  })}</ul>
                </details>
              )}
            </div>
          )}

          {/* Moments */}
          {activeTab === 'moments' && showMoments && sim && (
            <div role="tabpanel" id="panel-moments" aria-labelledby="tab-moments" className="rr-panel">
              <p className="rr-lead">The stretches where attention behaved unusually, and which parts of the brain drove them.</p>
              <ul className="rr-moments">
                {moments.map((m, i) => {
                  const info = momentInfo(m.kind);
                  const linked = all.map((ins, idx) => ({ ins, idx })).filter(({ ins }) => ins.startSec != null && ins.startSec <= m.end + 1 && (ins.endSec ?? ins.startSec) >= m.start - 1);
                  const isLive = isReel && now >= m.start && now <= m.end + 0.999;
                  return (
                    <li key={i} id={`moment-${i}`} className={`rr-moment rr-tone-${info.tone} ${activeMoment === i ? 'on' : ''} ${isLive ? 'live' : ''}`}>
                      {isReel && <FrameThumb src={src} time={m.start} width={frame.w} height={frame.h} className="rr-moment-frame" />}
                      <div className="rr-moment-body">
                        <header>
                          <span className={`st-chip ${info.tone}`}>{info.label}</span>
                          {isReel ? <button type="button" className="pf-time" onClick={() => playFrom(m.start)}><Icon name="play" size={11} /> {fmtClock(m.start)}{m.end > m.start ? `–${fmtClock(m.end)}` : ''}</button> : <span className="pf-time">{fmtClock(m.start)}</span>}
                          {isLive && <span className="rr-live">Playing now</span>}
                          <span className="rr-level">Attention {Math.round(m.level)}</span>
                        </header>
                        <p>{info.what}</p>
                        {m.drivers && m.drivers.length > 0 && (
                          <ul className="rr-drivers" aria-label="What drove this">
                            {m.drivers.slice(0, 3).map((d) => (
                              <li key={d.system}>
                                <span>{systemLabel(d.system)}</span>
                                <i className={`rr-drv rr-drv-${d.direction}`} aria-hidden="true"><b style={{ width: `${Math.min(100, (Math.abs(d.z) / 2.5) * 100)}%` }} /></i>
                                <em>{d.direction === 'high' ? 'Up' : 'Down'}</em>
                              </li>
                            ))}
                          </ul>
                        )}
                        {linked.length > 0 && <div className="rr-linked">{linked.map(({ ins, idx }) => <button key={idx} type="button" className="st-chip" onClick={() => pickFix(idx)}>{plain(ins.title)}</button>)}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Scores */}
          {activeTab === 'scores' && showScores && sim && (
            <div role="tabpanel" id="panel-scores" aria-labelledby="tab-scores" className="rr-panel">
              <p className="rr-lead">How the simulated audience responded, compared with {sim.baseline === 'library' ? 'similar reels' : 'the rest of this reel'}.</p>
              <ul className="rr-rows">
                {SCORE_ORDER.map((k) => {
                  const info = SCORE_INFO[k];
                  const s = sim.scores?.[k];
                  if (!info) return null;
                  if (!s) return <li key={k} className="rr-row-score rr-score-na"><div className="rr-rs-top"><b>{info.label}</b><span className="st-chip">Not measured</span></div><p>{info.what}</p></li>;
                  const z = zWords(s.z, info.lowerIsBetter);
                  return (
                    <li key={k} className={`rr-row-score rr-band-${band(s.value, info.lowerIsBetter)}`}>
                      <div className="rr-rs-top"><b>{info.label}</b><span className={`st-chip ${z.tone === 'flat' ? '' : z.tone}`}>{z.text}</span><strong>{Math.round(s.value)}<small>/100</small></strong></div>
                      <i className="rr-meter" aria-hidden="true"><b style={{ width: `${s.value}%` }} /></i>
                      <p>{info.what}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Brain */}
          {activeTab === 'brain' && sim && isReel && (
            <div role="tabpanel" id="panel-brain" aria-labelledby="tab-brain">
              <BrainGuide sim={sim} now={now} />
            </div>
          )}

          {/* AI review */}
          {activeTab === 'review' && (
            <div role="tabpanel" id="panel-review" aria-labelledby="tab-review" className="rr-panel">
              <p className="rr-lead">{plain(r.hook.reason)}</p>
              <div className="rr-dims">
                {r.dimensions.map((d) => (
                  <div key={d.key} className={`rr-dim rr-r-${d.rating.toLowerCase()}`}>
                    <div className="rr-dim-top"><span>{DIMENSION_LABELS[d.key] || d.key}</span><b>{RATING_LABELS[d.rating]}</b></div>
                    <p>{plain(d.note)}</p>
                  </div>
                ))}
              </div>
              {r.alternativeHooks.length > 0 && (
                <>
                  <h3 className="rr-eyebrow">Stronger openings to try</h3>
                  <ul className="rr-hooks">
                    {r.alternativeHooks.map((h) => (
                      <li key={h}>
                        <span>&ldquo;{plain(h)}&rdquo;</span>
                        <button className="btn btn-sm btn-soft" type="button" onClick={() => saveHook(h, check.platform)}><Icon name="star" size={13} /> Save</button>
                        <Link className="icon-btn" href={`/?compose=true&caption=${encodeURIComponent(plain(h))}`} aria-label="Start a post with this opening"><Icon name="send" size={13} /></Link>
                        <button className="icon-btn" type="button" aria-label="Copy opening" onClick={() => navigator.clipboard?.writeText(plain(h))}><Icon name="copy" size={13} /></button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <p className="form-hint pf-disclaimer">These are predictions, not guarantees. {check.engine === 'AUDIENCE_SIMULATION' ? 'The attention curve, signals and brain view come from a research model of how an average viewer processes video, not from measuring real viewers. ' : ''}Use them to compare versions and spot problems early.</p>
        </div>
      </aside>
    </div>
  );
}
