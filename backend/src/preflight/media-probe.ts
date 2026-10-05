import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { promisify } from 'util';

const run = promisify(execFile);
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

export type VideoFacts = { durationSec: number; width: number | null; height: number | null; hasAudio: boolean };
export type Frame = { atSec: number; jpegBase64: string };

/** ffmpeg/ffprobe wrappers for the pre-flight check. The backend image installs ffmpeg. */
export async function probeVideo(path: string): Promise<VideoFacts> {
  const { stdout } = await tool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path]);
  const info = JSON.parse(stdout.toString());
  const video = (info.streams || []).find((s: any) => s.codec_type === 'video');
  if (!video) throw new Error('This file has no video track.');
  return {
    durationSec: Number(info.format?.duration) || 0,
    width: video.width ?? null,
    height: video.height ?? null,
    hasAudio: (info.streams || []).some((s: any) => s.codec_type === 'audio'),
  };
}

/** Every second of the opening (where the skip decision happens), then evenly spread to the end. */
export function frameTimes(durationSec: number, max = 14): number[] {
  const end = Math.max(0, durationSec - 0.25);
  const opening = [0, 1, 2, 3].filter((t) => t <= end);
  const rest = max - opening.length;
  const from = 4;
  if (end <= from || rest <= 0) return opening;
  const step = (end - from) / Math.max(rest - 1, 1);
  const spread = Array.from({ length: rest }, (_, i) => Math.round((from + i * step) * 10) / 10);
  return [...new Set([...opening, ...spread])].filter((t) => t <= end);
}

export async function extractFrames(path: string, times: number[]): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const atSec of times) {
    const { stdout } = await tool('ffmpeg', ['-v', 'error', '-ss', String(atSec), '-i', path, '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-']);
    if (stdout.length) frames.push({ atSec, jpegBase64: stdout.toString('base64') });
  }
  return frames;
}

/** Hard cuts (scene changes), in seconds. Pacing signal for the review. */
export async function sceneCuts(path: string, maxSec = 180): Promise<number[]> {
  const { stderr } = await tool('ffmpeg', ['-v', 'info', '-t', String(maxSec), '-i', path, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-']);
  return [...stderr.toString().matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 10) / 10);
}

/** A JPEG small enough for the AI's vision input. Falls back to the original file when ffmpeg is missing. */
export async function imageForReview(path: string, mime: string): Promise<{ mediaType: string; data: string }> {
  try {
    const { stdout } = await tool('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-vf', "scale='min(1568,iw)':-2", '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-']);
    if (stdout.length) return { mediaType: 'image/jpeg', data: stdout.toString('base64') };
  } catch (error) {
    if (!(error instanceof MissingToolError)) throw error;
  }
  const raw = await fs.readFile(path);
  if (raw.length > MAX_AI_IMAGE_BYTES) throw new Error('This image is too large to review. Try one under 5 MB.');
  return { mediaType: mime, data: raw.toString('base64') };
}

export async function hashFiles(paths: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths) {
    await new Promise<void>((resolve, reject) => {
      createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve()).on('error', reject);
    });
  }
  return hash.digest('hex');
}

export class MissingToolError extends Error {}

async function tool(cmd: 'ffmpeg' | 'ffprobe', args: string[]) {
  try {
    return await run(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new MissingToolError('Video checks need ffmpeg installed on the server.');
    throw new Error(`${cmd} could not read this file.`);
  }
}
