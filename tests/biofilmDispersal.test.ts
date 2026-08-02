import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { BiofilmBiomass } from '../src/simulation/types';

interface DebugCell {
  id: string;
  biofilm: BiofilmBiomass;
  neighborIds: string[];
}

interface DebugWorld {
  allCells(): DebugCell[];
  stepBiofilmDispersal(deltaSeconds: number): void;
}

describe('biofilm dispersal', () => {
  const disconnectedNitrifierWorld = (): {
    world: SimulationWorld;
    internals: DebugWorld;
    source: DebugCell;
  } => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as DebugWorld;
    const cells = internals.allCells();
    for (const cell of cells) cell.neighborIds = [];
    const source = cells[Math.floor(cells.length / 2)]!;
    source.biofilm.nitrifier = 0.4;
    return { world, internals, source };
  };

  it('carries viable film to disconnected wetted surfaces without creating biomass', () => {
    const { internals, source } = disconnectedNitrifierWorld();
    const cells = internals.allCells();

    for (let second = 0; second < 600; second += 1) {
      internals.stepBiofilmDispersal(1);
    }

    const settledAwayFromSource = cells.reduce(
      (sum, cell) => sum + (cell.id === source.id ? 0 : cell.biofilm.nitrifier),
      0,
    );
    const attachedTotal = cells.reduce(
      (sum, cell) => sum + cell.biofilm.nitrifier,
      0,
    );
    expect(settledAwayFromSource).toBeGreaterThan(0.01);
    expect(attachedTotal).toBeGreaterThan(0.2);
    expect(attachedTotal).toBeLessThanOrEqual(0.4);
  });

  it('settles the same film mass at ordinary and fast ecology step sizes', () => {
    const ordinary = disconnectedNitrifierWorld();
    const fast = disconnectedNitrifierWorld();

    for (let step = 0; step < 400; step += 1) {
      ordinary.internals.stepBiofilmDispersal(0.25);
    }
    for (let step = 0; step < 100; step += 1) {
      fast.internals.stepBiofilmDispersal(1);
    }

    const attachedTotal = (internals: DebugWorld): number =>
      internals.allCells().reduce(
        (sum, cell) => sum + cell.biofilm.nitrifier,
        0,
      );
    const ordinaryTotal = attachedTotal(ordinary.internals);
    const fastTotal = attachedTotal(fast.internals);
    // Export, decay and settlement are operator-split at the ecology step.
    // The ordinary and fast paths must agree ecologically; exact bitwise
    // equality would incorrectly reject their sub-0.001% integration error.
    expect(Math.abs(ordinaryTotal - fastTotal) / fastTotal)
      .toBeLessThan(0.00001);
  });
});
