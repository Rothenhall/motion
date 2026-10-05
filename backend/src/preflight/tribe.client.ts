import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { readFile } from 'fs/promises';
import { basename } from 'path';

type Score = { value: number; percentile: number | null; z?: number } | null;

/** What the TRIBE v2 service (tribe-service/) returns for one clip. */
export type AudienceSimulation = {
  baseline: 'library' | 'clip';
  reference_label: string | null;
  seconds: number;
  curves: Record<string, number[]>;
  sound_off_attention: number[] | null;
  scores: Record<'hook' | 'hold' | 'ending' | 'human_pull_opening' | 'emotional_resonance' | 'text_load_peak' | 'message_clarity' | 'sound_off_resilience', Score>;
  facts: { first_face_second: number | null; short_clip: boolean; speech_seconds: number };
  moments: {
    kind: 'drop_risk' | 'text_overload' | 'peak';
    start: number;
    end: number;
    level: number;
    /** What stood out most during the moment (older service versions omit it). */
    drivers?: { system: string; direction: 'high' | 'low'; z: number }[];
  }[];
  transcript: { word: string; start: number; duration: number }[];
  has_audio: boolean;
  model: string;
  version: string;
  /** Per-second simulated cortical map (fsaverage5, uint8, zlib + base64), when asked for. */
  brain?: BrainMap;
};

export type BrainMap = { mesh: string; fps: number; shape: [number, number]; dtype: string; range: [number, number]; encoding: string; data: string };

/** The service has no cached result for this clip, and cacheOnly asked it not to run the model. */
export class NotCachedError extends Error {}

// Two TRIBE passes (with and without sound) took ~16 minutes for a fresh 28 s reel on Modal; the
// Modal function itself stops at 30 minutes.
const TIMEOUT_MS = 30 * 60 * 1000;

/** Client for the optional GPU service that runs TRIBE v2. Unset TRIBE_SERVICE_URL = feature runs on the AI review alone. */
@Injectable()
export class TribeClient {
  private readonly log = new Logger(TribeClient.name);

  get configured() {
    return Boolean(process.env.TRIBE_SERVICE_URL);
  }

  /**
   * Runs (or fetches the cached) simulation for a clip, including the brain map.
   * cacheOnly: answer only from the service's cache and throw NotCachedError instead of starting a GPU run.
   */
  async analyze(path: string, opts: { soundOff: boolean; cacheOnly?: boolean }): Promise<AudienceSimulation> {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)]), basename(path));
    form.append('sound_off', String(opts.soundOff));
    form.append('include_brain', 'true');
    if (opts.cacheOnly) form.append('cache_only', 'true');
    const token = process.env.TRIBE_SERVICE_TOKEN;
    try {
      const { data } = await axios.post(`${process.env.TRIBE_SERVICE_URL!.replace(/\/$/, '')}/analyze`, form, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: TIMEOUT_MS,
        maxBodyLength: Infinity,
        // Modal web endpoints answer requests longer than 150 s with a 303 to a URL that waits for the result.
        maxRedirects: 20,
      });
      if (!data || !Array.isArray(data.curves?.attention_index)) throw new Error('unexpected response');
      return data as AudienceSimulation;
    } catch (error: any) {
      if (opts.cacheOnly && error?.response?.status === 404) throw new NotCachedError('No cached simulation for this clip.');
      const detail = error?.response ? `HTTP ${error.response.status}` : error?.message || String(error);
      this.log.warn(`Audience simulation failed: ${detail}`);
      throw new Error('The audience simulation service did not respond.');
    }
  }
}
