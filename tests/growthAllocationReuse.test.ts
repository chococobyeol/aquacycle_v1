import { describe, expect, it } from 'vitest';
import type { AlgaePhysiologyRates } from '../src/simulation/growth';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesBiomass } from '../src/simulation/types';

interface GrowthCell {
  id: string;
  biomass: SpeciesBiomass;
}

interface GrowthInternals {
  allCells(): GrowthCell[];
  stepGrowth(deltaSeconds: number): void;
  vallisneriaCanopyPhysiology(...args: unknown[]): AlgaePhysiologyRates;
  growthOriginalScratch: SpeciesBiomass[];
  growthNextScratch: SpeciesBiomass[];
  growthIncomingDemandScratch: Float64Array;
  growthOutgoingDemandScratch: Float64Array;
}

describe('growth hot-loop allocation reuse', () => {
  it('does not build Vallisneria canopy geometry for empty ecology cells', () => {
    const world = new SimulationWorld('mission-7');
    const internals = world as unknown as GrowthInternals;
    const cells = internals.allCells();
    for (const cell of cells) cell.biomass.vallisneria = 0;
    cells[Math.floor(cells.length / 2)].biomass.vallisneria = 0.24;

    const originalCanopyPhysiology =
      internals.vallisneriaCanopyPhysiology.bind(world);
    let canopyCalls = 0;
    internals.vallisneriaCanopyPhysiology = (...args: unknown[]) => {
      canopyCalls += 1;
      return originalCanopyPhysiology(...args);
    };

    internals.stepGrowth(1);

    expect(canopyCalls).toBe(1);
    expect(canopyCalls).toBeLessThan(cells.length);
  });

  it('keeps cell biomass and growth scratch identities stable across repeated steps', () => {
    const world = new SimulationWorld('mission-7');
    const internals = world as unknown as GrowthInternals;
    const cells = internals.allCells();
    cells[Math.floor(cells.length / 2)].biomass.vallisneria = 0.24;

    internals.stepGrowth(1);
    const biomassByCell = new Map(
      internals.allCells().map((cell) => [cell.id, cell.biomass]),
    );
    const identities = {
      original: internals.growthOriginalScratch,
      originalItems: [...internals.growthOriginalScratch],
      next: internals.growthNextScratch,
      nextItems: [...internals.growthNextScratch],
      incoming: internals.growthIncomingDemandScratch,
      outgoing: internals.growthOutgoingDemandScratch,
    };

    for (let step = 0; step < 40; step += 1) internals.stepGrowth(1);

    expect(internals.growthOriginalScratch).toBe(identities.original);
    expect(internals.growthNextScratch).toBe(identities.next);
    identities.originalItems.forEach((item, index) => {
      expect(internals.growthOriginalScratch[index]).toBe(item);
    });
    identities.nextItems.forEach((item, index) => {
      expect(internals.growthNextScratch[index]).toBe(item);
    });
    expect(internals.growthIncomingDemandScratch).toBe(identities.incoming);
    expect(internals.growthOutgoingDemandScratch).toBe(identities.outgoing);
    for (const cell of internals.allCells()) {
      expect(cell.biomass).toBe(biomassByCell.get(cell.id));
    }
  });
});
