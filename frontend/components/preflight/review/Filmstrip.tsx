'use client';

import { useEffect, useRef } from 'react';
import { grabberFor } from './frames';

/**
 * A row of frames taken from the reel itself, so the timeline shows what is on screen at each moment.
 * Frames are grabbed in the browser from a hidden copy of the video; nothing is uploaded or stored.
 * If the video cannot be read (blocked, still loading) the strip simply stays as quiet blocks.
 */
export default function Filmstrip({ src, duration, count }: { src: string; duration: number; count: number }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    if (!src || duration <= 0) return;
    const grab = grabberFor(src);
    for (let i = 0; i < count; i++) {
      const canvas = refs.current[i];
      if (canvas) void grab.draw(canvas, ((i + 0.5) / count) * duration);
    }
  }, [src, duration, count]);

  return (
    <div className="rr-film" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <canvas key={i} width={64} height={114} ref={(el) => { refs.current[i] = el; }} />)}
    </div>
  );
}
