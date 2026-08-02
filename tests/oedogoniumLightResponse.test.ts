import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('Oedogonium local light response', () => {
  it('separates identical inocula by the irradiance of their actual surface cells', () => {
    const world = new SimulationWorld('mission-3');
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    const darkest = [...substrate].sort((left, right) => left.light - right.light)[0];
    const brightest = [...substrate].sort((left, right) => right.light - left.light)[0];

    expect(brightest.light).toBeGreaterThan(darkest.light + 20);
    for (const cell of [darkest, brightest]) {
      world.handle({
        type: 'pick-seed',
        speciesId: 'oedogonium',
        point: cell,
      });
      world.handle({ type: 'drop-held', point: cell });
    }

    const initial = world.snapshot();
    const localBiomass = (
      cells: typeof initial.cells,
      origin: typeof darkest,
    ): number => cells
      .filter((cell) => Math.hypot(cell.x - origin.x, cell.y - origin.y) <= 120)
      .reduce((sum, cell) => sum + cell.biomass.oedogonium, 0);
    const initialDark = localBiomass(initial.cells, darkest);
    const initialBright = localBiomass(initial.cells, brightest);
    expect(initialBright).toBeCloseTo(initialDark, 8);

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    while (world.snapshot().elapsedSeconds < 1_200) world.tick(0.1);

    const final = world.snapshot();
    const finalDark = localBiomass(final.cells, darkest);
    const finalBright = localBiomass(final.cells, brightest);
    expect(finalBright / initialBright)
      .toBeGreaterThan(finalDark / initialDark * 1.1);
  });
});
