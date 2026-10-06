import { describe, expect, it } from 'vitest';
import { API } from './api';
import { isVideoUrl, mediaSrc, parseMedia, toneFor } from './media';

describe('mediaSrc', () => {
  it('shows uploads from the API, whatever public address they were saved with', () => {
    expect(mediaSrc('https://tunnel.example.dev/media/1-aaaaaaaa.png')).toBe(`${API}/media/1-aaaaaaaa.png`);
    expect(mediaSrc(`${API}/media/clip.mp4`)).toBe(`${API}/media/clip.mp4`);
  });

  it('leaves other hosts and non-URLs alone', () => {
    expect(mediaSrc('https://cdn.example.com/photos/a.jpg')).toBe('https://cdn.example.com/photos/a.jpg');
    expect(mediaSrc('not a url')).toBe('not a url');
  });
});

describe('parseMedia', () => {
  it('reads the JSON string stored on posts and arrays already parsed', () => {
    expect(parseMedia('["a","b"]')).toEqual(['a', 'b']);
    expect(parseMedia(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('copes with missing, broken or wrongly shaped values', () => {
    expect(parseMedia(null)).toEqual([]);
    expect(parseMedia('{bad')).toEqual([]);
    expect(parseMedia('{"a":1}')).toEqual([]);
    expect(parseMedia('["a",3,null]')).toEqual(['a']);
  });
});

describe('isVideoUrl', () => {
  it('recognises video files by extension, with or without a query', () => {
    expect(isVideoUrl('https://x.test/media/a.mp4')).toBe(true);
    expect(isVideoUrl('https://x.test/media/a.mov?v=2')).toBe(true);
    expect(isVideoUrl('https://x.test/media/a.png')).toBe(false);
  });
});

describe('toneFor', () => {
  it('gives the same post the same tone every time', () => {
    expect(toneFor('post-1')).toBe(toneFor('post-1'));
    expect(toneFor('post-1')).toMatch(/^st-tone-[1-8]$/);
  });
});
