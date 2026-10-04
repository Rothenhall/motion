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
};

// Two TRIBE passes (with and without sound) can take several minutes on one GPU.
const TIMEOUT_MS = 20 * 60 * 1000;

/** Client for the optional GPU service that runs TRIBE v2. Unset TRIBE_SERVICE_URL = feature runs on Claude alone. */
@Injectable()
export class TribeClient {
  private readonly log = new Logger(TribeClient.name);

  get configured() {
    return Boolean(process.env.TRIBE_SERVICE_URL);
  }

  async analyze(path: string, opts: { soundOff: boolean }): Promise<AudienceSimulation> {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)]), basename(path));
    form.append('sound_off', String(opts.soundOff));
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
      const detail = error?.response ? `HTTP ${error.response.status}` : error?.message || String(error);
      this.log.warn(`Audience simulation failed: ${detail}`);
      throw new Error('The audience simulation service did not respond.');
    }
  }
}
