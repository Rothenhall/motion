'use client';

export type TrendPoint = { date: string; views: number; engagements: number };

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function shortDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: '2-digit', timeZone: 'UTC' }); }

/** Two series on one chart, each scaled to its own max so engagement stays readable next to views. */
export default function TrendChart({ series, id = 'trend' }: { series: TrendPoint[]; id?: string }) {
  const W = 760, TOP = 20, BOTTOM = 170;
  const maxViews = Math.max(1, ...series.map((s) => s.views));
  const maxEng = Math.max(1, ...series.map((s) => s.engagements));
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : W / 2);
  const y = (v: number, max: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = (key: 'views' | 'engagements', max: number) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[key], max).toFixed(1)}`).join(' ');
  const views = line('views', maxViews);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  const totalViews = series.reduce((sum, s) => sum + s.views, 0);
  const totalEng = series.reduce((sum, s) => sum + s.engagements, 0);
  return (
    <svg viewBox="0 0 760 210" role="img" aria-label={`Daily views and engagements over ${series.length} days: ${compact.format(totalViews)} views in total (peak ${compact.format(maxViews)} a day), ${compact.format(totalEng)} engagements (peak ${compact.format(maxEng)} a day).`}>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand-600)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--brand-600)" stopOpacity="0" /></linearGradient></defs>
      {[20, 70, 120, 170].map((gy) => <line key={gy} className="chart-grid-line" x1="0" y1={gy} x2="760" y2={gy} />)}
      {series.length > 1 && <path d={`${views} V190 H0Z`} fill={`url(#${id}-fill)`} />}
      <path className="chart-line" d={views} />
      <path className="chart-line-secondary" d={line('engagements', maxEng)} />
      {series.map((s, i) => {
        const last = i === series.length - 1;
        if (i % labelEvery !== 0 && !last) return null;
        if (!last && series.length - 1 - i < labelEvery / 2) return null;
        return <text key={s.date} className="chart-label" x={x(i)} y="205" textAnchor={i === 0 ? 'start' : last ? 'end' : 'middle'}>{shortDate(s.date)}</text>;
      })}
    </svg>
  );
}
