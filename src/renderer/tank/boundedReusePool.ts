/**
 * Small keyed pool for expensive renderer objects.
 *
 * Chromium keeps V8 heap regions reserved after short-lived Pixi display trees
 * are collected. Reusing a bounded high-water mark prevents a long ecosystem
 * run from allocating one new tree for every birth and death.
 */
export class BoundedReusePool<Key, Value> {
  private readonly values = new Map<Key, Value[]>();

  public constructor(private readonly maximumPerKey: number) {
    if (!Number.isInteger(maximumPerKey) || maximumPerKey < 0) {
      throw new RangeError('Pool capacity must be a non-negative integer.');
    }
  }

  public take(key: Key): Value | undefined {
    const bucket = this.values.get(key);
    const value = bucket?.pop();
    if (bucket?.length === 0) this.values.delete(key);
    return value;
  }

  /**
   * Returns true when the value was retained. A false result tells the owner to
   * destroy the overflow value immediately.
   */
  public release(key: Key, value: Value): boolean {
    const bucket = this.values.get(key);
    if (bucket) {
      if (bucket.length >= this.maximumPerKey) return false;
      bucket.push(value);
      return true;
    }
    if (this.maximumPerKey === 0) return false;
    this.values.set(key, [value]);
    return true;
  }

  public size(key: Key): number {
    return this.values.get(key)?.length ?? 0;
  }

  public drain(dispose: (value: Value) => void): void {
    for (const bucket of this.values.values()) {
      for (const value of bucket) dispose(value);
    }
    this.values.clear();
  }
}
