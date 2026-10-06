import { describe, expect, it } from 'vitest';
import { plain } from './text';

describe('plain', () => {
  it('replaces em dashes with a comma, whatever the spacing', () => {
    expect(plain('Stop scrolling — watch this')).toBe('Stop scrolling, watch this');
    expect(plain('one—two')).toBe('one, two');
  });

  it('leaves en dashes in ranges alone', () => {
    expect(plain('Slow from 0:24–0:29')).toBe('Slow from 0:24–0:29');
  });

  it('passes empty values through', () => {
    expect(plain(null)).toBeNull();
    expect(plain(undefined)).toBeUndefined();
    expect(plain('')).toBe('');
  });
});
