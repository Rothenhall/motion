/**
 * One hidden copy of the reel per video, shared by everything that shows a frame: the filmstrip, the fix cards and the
 * hover preview. Requests run one at a time (a video can only seek to one place at once), and a canvas that asks again
 * before its turn comes up replaces its older request, so scrubbing never builds a backlog.
 */
class Grabber {
  private video: HTMLVideoElement;
  private ready: Promise<boolean>;
  private chain: Promise<void> = Promise.resolve();
  private latest = new WeakMap<HTMLCanvasElement, number>();
  private seq = 0;

  constructor(src: string) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.src = src;
    this.ready = this.once('loadeddata', 6000).then(() => !!this.video.videoWidth);
  }

  private once(event: string, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => { this.video.removeEventListener(event, done); window.clearTimeout(timer); resolve(); };
      const timer = window.setTimeout(done, ms);
      this.video.addEventListener(event, done);
    });
  }

  /** Stops the hidden video loading. Called when nothing on screen needs its frames any more. */
  dispose() {
    this.video.removeAttribute('src');
    this.video.load();
  }

  /** Draws the frame at `time` (seconds) into the canvas, cover-fitted. Resolves false if the frame could not be read. */
  draw(canvas: HTMLCanvasElement, time: number): Promise<boolean> {
    const ticket = ++this.seq;
    this.latest.set(canvas, ticket);
    return new Promise((resolve) => {
      this.chain = this.chain.then(async () => {
        if (this.latest.get(canvas) !== ticket || !canvas.isConnected) return resolve(false);
        if (!(await this.ready)) return resolve(false);
        const v = this.video;
        v.currentTime = Math.min(Math.max(0, (v.duration || time) - 0.05), Math.max(0, time));
        await this.once('seeked', 2500);
        const ctx = canvas.getContext('2d');
        if (!ctx || this.latest.get(canvas) !== ticket) return resolve(false);
        const scale = Math.max(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
        const w = v.videoWidth * scale, h = v.videoHeight * scale;
        try { ctx.drawImage(v, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); canvas.dataset.ready = '1'; resolve(true); } catch { resolve(false); }
      });
    });
  }
}

const grabbers = new Map<string, Grabber>();
export const grabberFor = (src: string) => {
  let g = grabbers.get(src);
  if (!g) { g = new Grabber(src); grabbers.set(src, g); }
  return g;
};

/** Frees the hidden video for this reel. Anything that asks for a frame again simply starts a new one. */
export const releaseGrabber = (src: string) => {
  grabbers.get(src)?.dispose();
  grabbers.delete(src);
};
