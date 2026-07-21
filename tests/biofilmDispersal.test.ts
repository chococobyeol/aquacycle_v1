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
  it('carries viable film to disconnected wetted surfaces without creating biomass', () => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as DebugWorld;
    const cells = internals.allCells();
    for (const cell of cells) cell.neighborIds = [];
    const source = cells[Math.floor(cells.length / 2)]!;
    source.biofilm.nitrifier = 0.4;

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
});
