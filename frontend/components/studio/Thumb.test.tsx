import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { API } from '@/lib/api';
import Thumb from './Thumb';

const media = (...urls: string[]) => JSON.stringify(urls);

describe('Thumb', () => {
  it('shows an upload from the API even when it was saved with the public tunnel address', () => {
    const { container } = render(<Thumb id="p1" media={media('https://tunnel.example.dev/media/1-aaaaaaaa.png')} mediaType="IMAGE" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(`${API}/media/1-aaaaaaaa.png`);
  });

  it('falls back to the caption when the file cannot be loaded', () => {
    const { container, getByText } = render(<Thumb id="p1" media={media('https://x.test/media/1-aaaaaaaa.png')} mediaType="IMAGE" caption="Launch day" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('Launch day')).not.toBeNull();
  });

  it('tries again when the media is replaced after a failure', () => {
    const { container, rerender } = render(<Thumb id="p1" media={media('https://x.test/media/1-aaaaaaaa.png')} mediaType="IMAGE" caption="Launch day" />);
    fireEvent.error(container.querySelector('img')!);
    rerender(<Thumb id="p1" media={media('https://x.test/media/2-bbbbbbbb.png')} mediaType="IMAGE" caption="Launch day" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(`${API}/media/2-bbbbbbbb.png`);
  });

  it('shows a video as a muted preview with a play mark', () => {
    const { container } = render(<Thumb id="p2" media={media('https://x.test/media/3-cccccccc.mp4')} mediaType="REELS" />);
    expect(container.querySelector('video')?.getAttribute('src')).toContain(`${API}/media/3-cccccccc.mp4`);
    expect(container.querySelector('.st-play')).not.toBeNull();
  });

  it('shows the caption on a tone card when a post has no media', () => {
    const { container, getByText } = render(<Thumb id="p3" media="[]" mediaType="TEXT" caption="Just words" />);
    expect(container.querySelector('img, video')).toBeNull();
    expect(getByText('Just words')).not.toBeNull();
  });
});
