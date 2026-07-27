import { describe, expect, it, vi } from 'vitest';
import { BoundedReusePool } from '../src/renderer/tank/boundedReusePool';

describe('bounded renderer reuse pool', () => {
  it('reuses the retained high-water mark and rejects overflow', () => {
    const pool = new BoundedReusePool<string, { id: number }>(2);
    const first = { id: 1 };
    const second = { id: 2 };
    const overflow = { id: 3 };

    expect(pool.release('daphnia', first)).toBe(true);
    expect(pool.release('daphnia', second)).toBe(true);
    expect(pool.release('daphnia', overflow)).toBe(false);
    expect(pool.size('daphnia')).toBe(2);
    expect(pool.take('daphnia')).toBe(second);
    expect(pool.take('daphnia')).toBe(first);
    expect(pool.take('daphnia')).toBeUndefined();
  });

  it('drains every detached display exactly once', () => {
    const pool = new BoundedReusePool<string, { id: number }>(3);
    const dispose = vi.fn();
    pool.release('living', { id: 1 });
    pool.release('living', { id: 2 });
    pool.release('carcass', { id: 3 });

    pool.drain(dispose);
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(pool.size('living')).toBe(0);
    expect(pool.size('carcass')).toBe(0);
  });
});
