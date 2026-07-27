import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import { Container, Graphics } from 'pixi.js';
import {
  destroyDisplayTree,
  visibleAnimalCarcasses,
} from '../src/renderer/tank/AquariumCanvas';
import type {
  AnimalCarcassSnapshot,
  SelectionSnapshot,
} from '../src/simulation/types';

const daphniaCarcass = (index: number): AnimalCarcassSnapshot => ({
  id: `carcass:daphnia-${index}`,
  sourceAnimalId: `daphnia-${index}`,
  speciesId: 'daphnia',
  x: index,
  y: 300,
  facing: 1,
  poseAngle: 0,
  bodyLength: 9,
  lifeStage: 'adult',
  cause: 'old-age',
  waterAtDeath: null,
  temperatureAtDeath: 24,
  ageSeconds: 0,
  lifetimeSeconds: 140,
  progress: 0,
});

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

  it('bounds active Daphnia display trees while retaining a selected older corpse', () => {
    const carcasses = Array.from({ length: 300 }, (_, index) =>
      daphniaCarcass(index));
    const selection: SelectionSnapshot = {
      kind: 'carcass',
      x: 0,
      y: 300,
      ownerLabel: '물벼룩 · 죽은 개체',
      carcassId: carcasses[0].id,
    };

    const visible = visibleAnimalCarcasses({ carcasses, selection });

    expect(visible).toHaveLength(129);
    expect(visible.some((carcass) => carcass.id === carcasses[0].id)).toBe(true);
    expect(visible.some((carcass) => carcass.id === carcasses.at(-1)!.id)).toBe(true);
  });
});
