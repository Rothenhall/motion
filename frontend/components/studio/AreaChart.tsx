'use client';

import { compactNumber } from '../../lib/format';
import type { TrendPoint } from '../TrendChart';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Views as a filled area with engagements as a dashed line (each on its own scale), drawn for the ink hero tile.
 * The peak day is labelled so the chart says something even before you hover.
 */
export default function AreaChart({ series, id = 'area' }: { series: TrendPoint[]; id?: string }) {
  const W = 600, H = 150, L = 4, R = 4, T = 22, B = 22;
  if (series.length < 2) return null;
  const maxV = Math.max(1, ...series.map((s) => s.views));
  const maxE = Math.max(1, ...series.map((s) => s.engagements));
  const x = (i: number) => L + (i / (series.length - 1)) * (W - L - R);
  const y = (v: number, max: number) => H - B - (v / max) * (H - B - T);
  const line = (key: 'views' | 'engagements', max: number) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[key], max).toFixed(1)}`).join(' ');
  const peak = series.reduce((best, s, i) => (s.views > series[best].views ? i : best), 0);
  const last = series.length - 1;
  const labelAt = [0, Math.round(last / 2), last];
  const px = x(peak);
  return (
    <svg className="st-area" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Views over ${series.length} days, peaking at ${compactNumber(series[peak].views)} on ${shortDate(series[peak].date)}.`}>
      <defs><linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".26" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2].map((g) => <line key={g} x1={L} x2={W - R} y1={T + g * ((H - B - T) / 2)} y2={T + g * ((H - B - T) / 2)} stroke="#fff" strokeOpacity=".09" />)}
      <path d={`${line('views', maxV)} V${H - B} H${L}Z`} fill={`url(#${id}-f)`} />
      <path d={line('engagements', maxE)} fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={line('views', maxV)} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={px} cy={y(series[peak].views, maxV)} r="4" fill="#fff" />
      <text x={Math.min(Math.max(px, 30), W - 30)} y={Math.max(y(series[peak].views, maxV) - 9, 12)} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="650">{compactNumber(series[peak].views)}</text>
      {labelAt.map((i, k) => <text key={i} x={x(i)} y={H - 6} fill="#fff" fillOpacity=".55" fontSize="10.5" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>{shortDate(series[i].date)}</text>)}
    </svg>
  );
}
