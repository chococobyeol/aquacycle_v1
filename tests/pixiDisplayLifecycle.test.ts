import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import { Container, Graphics } from 'pixi.js';
import { destroyDisplayTree } from '../src/renderer/tank/AquariumCanvas';

describe('Pixi display lifecycle', () => {
  it('destroys vector contexts during repeated animal display turnover', () => {
    for (let generation = 0; generation < 250; generation += 1) {
      const root = new Container();
      const art = new Container();
      const graphics = Array.from({ length: 10 }, (_, index) =>
        new Graphics()
          .circle(index, index, 2)
          .fill({ color: 0xcc7766 }),
      );
      const contexts = graphics.map((graphic) => graphic.context);
      art.addChild(...graphics);
      root.addChild(art);

      destroyDisplayTree(root);

      expect(root.destroyed).toBe(true);
      expect(graphics.every((graphic) => graphic.destroyed)).toBe(true);
      expect(contexts.every((context) => context.destroyed)).toBe(true);
    }
  });
});
