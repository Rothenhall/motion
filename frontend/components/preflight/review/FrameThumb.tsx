'use client';

import { useEffect, useRef } from 'react';
import { grabberFor } from './frames';

/** The reel's frame at a given second, for cards that talk about that moment. Falls back to an empty block if unreadable. */
export default function FrameThumb({ src, time, className = '', width = 96, height = 170 }: { src: string; time: number; className?: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && src) void grabberFor(src).draw(ref.current, time);
  }, [src, time]);
  return <canvas ref={ref} width={width} height={height} className={`rr-frame ${className}`} aria-hidden="true" />;
}
