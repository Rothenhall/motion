import { fmtClock } from '../../../lib/format';
import type { Check, Simulation } from '../shared';

/** The audience simulation as the service actually returns it (the shared type only lists what the old page read). */
type Score = { value: number; percentile: number | null; z: number } | null;
type Driver = { system: string; direction: 'high' | 'low'; z: number };
type Moment = { kind: string; start: number; end: number; level: number; drivers?: Driver[] };
export type FullSim = Omit<Simulation, 'moments' | 'facts'> & {
  scores?: Record<string, Score>;
  facts: { first_face_second?: number | null; short_clip: boolean; speech_seconds?: number };
  moments: Moment[];
};
export type VideoFacts = { durationSec: number; width?: number; height?: number; hasAudio?: boolean; cuts?: number[]; frameTimes?: number[] };

export const simOf = (check: Check) => (check.signals?.simulation as unknown as FullSim | undefined) ?? null;
export const videoOf = (check: Check) => (check.signals?.video as VideoFacts | undefined) ?? null;

/** The brain systems the model reports, in words a creator would use. */
const SYSTEM_LABEL: Record<string, string> = {
  attention: 'Overall attention',
  visual_motion: 'Motion on screen',
  auditory: 'Sound and music',
  text_reading: 'Reading on-screen text',
  default_mode: 'Mind wandering',
  faces: 'Faces',
  language: 'Speech and language',
  social: 'People and social cues',
  scenes: 'Places and scene changes',
  early_visual: 'Basic visual detail',
};

/** A readable name for any brain system, including ones this list does not know about yet. */
export const systemLabel = (key: string) => SYSTEM_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Signal lanes for the timeline, in the order they are drawn. */
export const LANES: { key: string; label: string; hint: string }[] = [
  { key: 'faces', label: 'Faces', hint: 'How strongly viewers are drawn to faces.' },
  { key: 'language', label: 'Speech', hint: 'Spoken and written language being processed.' },
  { key: 'text_reading', label: 'On-screen text', hint: 'Reading load from captions and text overlays.' },
  { key: 'social', label: 'People', hint: 'Social cues: gestures, bodies, interaction.' },
  { key: 'auditory', label: 'Sound', hint: 'Music, sound effects and voice.' },
  { key: 'visual_motion', label: 'Motion', hint: 'Movement and visual change on screen.' },
  { key: 'scenes', label: 'Scenes', hint: 'Places, objects and scene changes.' },
];

const MOMENT_INFO: Record<string, { label: string; tone: 'good' | 'warn' | 'bad'; what: string }> = {
  peak: { label: 'Attention peak', tone: 'good', what: 'Viewers are most absorbed here. Whatever is on screen works, so repeat the pattern.' },
  drop_risk: { label: 'Drop-off risk', tone: 'bad', what: 'Attention sags here, and this is where people are most likely to swipe away.' },
  text_overload: { label: 'Text overload', tone: 'warn', what: 'There is a lot to read at once, which competes with the visuals for attention.' },
};
export const momentInfo = (kind: string) => MOMENT_INFO[kind] ?? { label: kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'warn' as const, what: 'A notable stretch of the reel.' };

/** What each score means and which way is good. text_load_peak is the odd one: higher is heavier, not better. */
export const SCORE_INFO: Record<string, { label: string; what: string; lowerIsBetter?: boolean }> = {
  hook: { label: 'Hook', what: 'How strongly the opening seconds capture attention.' },
  hold: { label: 'Hold', what: 'How well attention is kept through the middle of the reel.' },
  ending: { label: 'Ending', what: 'Attention in the closing seconds, where a call to action lands.' },
  human_pull_opening: { label: 'Human pull', what: 'How much faces and people draw viewers in during the opening.' },
  emotional_resonance: { label: 'Emotional pull', what: 'Emotional and social engagement across the whole reel.' },
  text_load_peak: { label: 'Text load', what: 'The heaviest reading load in the reel. Lower is easier to follow.', lowerIsBetter: true },
  message_clarity: { label: 'Message clarity', what: 'How clearly the spoken message comes across. Needs speech to measure.' },
  sound_off_resilience: { label: 'Sound-off hold', what: 'How much attention survives when the reel autoplays muted.' },
};
export const SCORE_ORDER = ['hook', 'hold', 'ending', 'human_pull_opening', 'emotional_resonance', 'sound_off_resilience', 'text_load_peak', 'message_clarity'];

/** z against the reference, in words. For "lower is better" scores the wording flips. */
export function zWords(z: number, lowerIsBetter?: boolean) {
  if (z >= 0.5) return lowerIsBetter ? { text: 'Heavier than typical', tone: 'warn' as const } : { text: 'Above typical', tone: 'good' as const };
  if (z <= -0.5) return lowerIsBetter ? { text: 'Lighter than typical', tone: 'good' as const } : { text: 'Below typical', tone: 'warn' as const };
  return { text: 'Typical', tone: 'flat' as const };
}

/** Colour band for a 0-100 score. */
export function band(value: number, lowerIsBetter?: boolean) {
  const v = lowerIsBetter ? 100 - value : value;
  return v >= 60 ? 'good' : v >= 40 ? 'mid' : 'low';
}

/** The reel at a given second, in words: attention, and what is driving it. */
export function nowReading(sim: FullSim, second: number) {
  const i = Math.max(0, Math.min((sim.curves.attention_index?.length ?? 1) - 1, Math.floor(second)));
  const attention = sim.curves.attention_index?.[i];
  const drivers = Object.entries(sim.curves)
    .filter(([k]) => k !== 'attention_index' && sim.curves[k]?.length)
    .map(([k, c]) => {
      const mean = c.reduce((a, b) => a + b, 0) / c.length;
      return { key: k, delta: (c[i] ?? mean) - mean };
    })
    .sort((a, b) => b.delta - a.delta)
    .filter((d) => d.delta > 4)
    .slice(0, 2)
    .map((d) => systemLabel(d.key));
  const moment = sim.moments.find((m) => second >= m.start && second <= m.end + 0.999) ?? null;
  return { attention, drivers, moment };
}

export { fmtClock };

/**
 * What each brain system is and what it means for a reel. Areas follow the simulation service's own definitions
 * (HCP-MMP1 parcels grouped by the literature), which it describes as a coarse approximation, so the wording stays modest.
 */
const BRAIN_SYSTEMS: { key: string; label: string; area: string; means: string; high: string; low?: string }[] = [
  { key: 'visual_motion', label: 'Motion on screen', area: 'Motion-sensitive visual areas (MT, MST)', means: 'Movement pulls the eye. Action and fast cuts raise it; still shots lower it.', high: 'lots of movement is pulling the eye', low: 'very little is moving' },
  { key: 'faces', label: 'Faces', area: 'Face-recognition areas (fusiform and posterior temporal)', means: 'A face or person is holding attention. A face early on tends to help the hook.', high: 'a face is holding attention', low: 'there is no face to connect with' },
  { key: 'text_reading', label: 'On-screen text', area: 'Reading area (left visual word-form region)', means: 'Viewers are reading. A lot of text at once competes with the picture.', high: 'viewers are reading on-screen text' },
  { key: 'language', label: 'Speech and words', area: 'Language network (left frontal and temporal areas)', means: 'Viewers are following spoken or written meaning.', high: 'viewers are following the speech', low: 'there is little speech to follow' },
  { key: 'auditory', label: 'Sound and music', area: 'Auditory cortex', means: 'Sound is carrying the moment: music, voice and effects.', high: 'sound is carrying the moment', low: 'sound is quiet' },
  { key: 'social', label: 'People and feelings', area: 'Social-thinking areas (temporoparietal junction, medial prefrontal)', means: 'Viewers are reading intentions, stories or emotions. Linked to emotional pull.', high: 'people and emotion are drawing viewers in', low: 'there are few people or feelings on screen' },
  { key: 'scenes', label: 'Places and scenery', area: 'Scene-recognition areas (parahippocampal)', means: 'The setting is being taken in, often when the scene changes.', high: 'the setting is being taken in', low: 'the scene is static' },
];

export const ATTENTION_EXPLAINER = 'Overall attention averages the response of the focus network, motion areas, auditory cortex and face areas, then subtracts half of the mind-wandering network. 50 is typical for this reel, so above 50 is more engaged than its usual and below 50 is drifting.';

const THRESHOLD = 6; // curve points above or below a system's own average before it counts as notable

/** The current second in plain words, plus every system's value against its own average. */
export function brainNow(sim: FullSim, second: number) {
  const len = sim.curves.attention_index?.length ?? 0;
  const i = Math.max(0, Math.min(len - 1, Math.floor(second)));
  const attention = sim.curves.attention_index?.[i];
  const systems = BRAIN_SYSTEMS.filter((s) => sim.curves[s.key]?.length).map((s) => {
    const c = sim.curves[s.key];
    const mean = c.reduce((a, b) => a + b, 0) / c.length;
    const value = c[Math.min(i, c.length - 1)];
    return { ...s, value, mean, delta: value - mean };
  });
  const ups = [...systems].filter((s) => s.delta >= THRESHOLD).sort((a, b) => b.delta - a.delta).slice(0, 2);
  const downs = [...systems].filter((s) => s.delta <= -THRESHOLD && s.low).sort((a, b) => a.delta - b.delta).slice(0, 2);
  const level = attention == null ? null : attention >= 60 ? 'high' : attention <= 40 ? 'sagging' : 'typical';
  const lead = level === 'high' ? 'Attention is high.' : level === 'sagging' ? 'Attention is sagging.' : level === 'typical' ? 'Attention is about typical.' : '';
  const join = (parts: string[]) => (parts.length > 1 ? `${parts[0]} and ${parts[1]}` : parts[0]);
  const why = level === 'sagging' && downs.length ? join(downs.map((d) => d.low!)) : ups.length ? join(ups.map((u) => u.high)) : downs.length ? join(downs.map((d) => d.low!)) : '';
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const sentence = [lead, why ? `${cap(why)}.` : 'Nothing stands out at this moment.'].filter(Boolean).join(' ');
  return { attention, level, sentence, systems, ups };
}
