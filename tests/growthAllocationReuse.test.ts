import { describe, expect, it } from 'vitest';
import {
  algaePhysiology,
  type AlgaePhysiologyRates,
} from '../src/simulation/growth';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesBiomass, Vec2 } from '../src/simulation/types';
import {
  vallisneriaLeafPoint,
  vallisneriaLeaves,
  type VallisneriaCanopyBounds,
  type VallisneriaLeafGeometry,
} from '../src/simulation/vallisneriaGeometry';

interface GrowthCell {
  id: string;
  index: number;
  x: number;
  y: number;
  biomass: SpeciesBiomass;
}

interface GrowthInternals {
  allCells(): GrowthCell[];
  stepGrowth(deltaSeconds: number): void;
  biogeochemistry: {
    algaeResourceFactor(point: Vec2): number;
  };
  vallisneriaResourceFactor(cell: GrowthCell): number;
  vallisneriaCanopyPhysiology(
    cell: GrowthCell,
    temperature: number,
    reuse?: AlgaePhysiologyRates,
  ): AlgaePhysiologyRates;
  vallisneriaPhysiologySampleScratch: AlgaePhysiologyRates;
  growthOriginalScratch: Float64Array;
  growthNextScratch: Float64Array;
  growthIncomingDemandScratch: Float64Array;
  growthOutgoingDemandScratch: Float64Array;
  sampleLightField(point: Vec2): number;
  vallisneriaLeavesScratch: VallisneriaLeafGeometry[];
  vallisneriaCanopyPointsScratch: Vec2[];
  vallisneriaCanopyLightsScratch: Float64Array;
  vallisneriaLeafPointScratch: Vec2;
  vallisneriaActivityPointScratch: Vec2;
  vallisneriaUptakePointScratch: Vec2;
  vallisneriaCanopyBoundsScratch: VallisneriaCanopyBounds;
  vallisneriaPhysiologyRatesScratch: Float64Array;
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
    internals.vallisneriaCanopyPhysiology = (cell, temperature, reuse) => {
      canopyCalls += 1;
      return originalCanopyPhysiology(cell, temperature, reuse);
    };

    internals.stepGrowth(1);

    expect(canopyCalls).toBe(1);
    expect(canopyCalls).toBeLessThan(cells.length);
  });

  it('keeps the canopy average exact even if the caller supplies the leaf scratch', () => {
    const world = new SimulationWorld('mission-7');
    const internals = world as unknown as GrowthInternals;
    const cell = internals.allCells().find((candidate) =>
      candidate.id.startsWith('substrate:')
    );
    expect(cell).toBeDefined();
    if (!cell) return;

    const expected: AlgaePhysiologyRates = {
      grossPhotosynthesis: 0,
      respiration: 0,
      lightStressTurnover: 0,
      netGrowth: 0,
    };
    const leaves = vallisneriaLeaves(
      cell.index,
      { x: cell.x, y: cell.y },
      0.72,
    );
    const lights = leaves.flatMap((leaf) =>
      [0.25, 0.5, 0.75, 1].map((position) =>
        internals.sampleLightField(vallisneriaLeafPoint(leaf, position))
      )
    );
    for (const light of lights) {
      const sample = algaePhysiology('vallisneria', light, 24);
      expected.grossPhotosynthesis += sample.grossPhotosynthesis;
      expected.respiration += sample.respiration;
      expected.lightStressTurnover += sample.lightStressTurnover;
      expected.netGrowth += sample.netGrowth;
    }
    expected.grossPhotosynthesis /= lights.length;
    expected.respiration /= lights.length;
    expected.lightStressTurnover /= lights.length;
    expected.netGrowth /= lights.length;

    const reuse = internals.vallisneriaPhysiologySampleScratch;
    const actual = internals.vallisneriaCanopyPhysiology(cell, 24, reuse);

    expect(actual).toBe(reuse);
    expect(actual.grossPhotosynthesis).toBe(expected.grossPhotosynthesis);
    expect(actual.respiration).toBe(expected.respiration);
    expect(actual.lightStressTurnover).toBe(expected.lightStressTurnover);
    expect(actual.netGrowth).toBe(expected.netGrowth);
  });

  it('averages rooted and leaf resources instead of selecting the richest point', () => {
    const world = new SimulationWorld('mission-7');
    const internals = world as unknown as GrowthInternals;
    const cell = internals.allCells().find((candidate) =>
      candidate.id.startsWith('substrate:')
    );
    expect(cell).toBeDefined();
    if (!cell) return;
    cell.biomass.vallisneria = 0.24;

    const original = internals.biogeochemistry.algaeResourceFactor.bind(
      internals.biogeochemistry,
    );
    let samples = 0;
    internals.biogeochemistry.algaeResourceFactor = (point) => {
      samples += 1;
      return point.y < cell.y - 30 ? 0.9 : 0.2;
    };
    try {
      const factor = internals.vallisneriaResourceFactor(cell);
      expect(samples).toBeGreaterThan(2);
      expect(factor).toBeGreaterThan(0.2);
      expect(factor).toBeLessThan(0.9);
    } finally {
      internals.biogeochemistry.algaeResourceFactor = original;
    }
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
      originalBuffer: internals.growthOriginalScratch.buffer,
      next: internals.growthNextScratch,
      nextBuffer: internals.growthNextScratch.buffer,
      incoming: internals.growthIncomingDemandScratch,
      outgoing: internals.growthOutgoingDemandScratch,
      leaves: internals.vallisneriaLeavesScratch,
      canopyPoints: internals.vallisneriaCanopyPointsScratch,
      canopyLights: internals.vallisneriaCanopyLightsScratch,
      leafPoint: internals.vallisneriaLeafPointScratch,
      activityPoint: internals.vallisneriaActivityPointScratch,
      uptakePoint: internals.vallisneriaUptakePointScratch,
      bounds: internals.vallisneriaCanopyBoundsScratch,
      physiologyRates: internals.vallisneriaPhysiologyRatesScratch,
    };

    for (let step = 0; step < 40; step += 1) internals.stepGrowth(1);

    expect(internals.growthOriginalScratch).toBe(identities.original);
    expect(internals.growthNextScratch).toBe(identities.next);
    expect(internals.growthOriginalScratch.buffer).toBe(identities.originalBuffer);
    expect(internals.growthNextScratch.buffer).toBe(identities.nextBuffer);
    expect(internals.growthIncomingDemandScratch).toBe(identities.incoming);
    expect(internals.growthOutgoingDemandScratch).toBe(identities.outgoing);
    expect(internals.vallisneriaLeavesScratch).toBe(identities.leaves);
    expect(internals.vallisneriaCanopyPointsScratch).toBe(
      identities.canopyPoints,
    );
    expect(internals.vallisneriaCanopyLightsScratch).toBe(
      identities.canopyLights,
    );
    expect(internals.vallisneriaLeafPointScratch).toBe(identities.leafPoint);
    expect(internals.vallisneriaActivityPointScratch).toBe(
      identities.activityPoint,
    );
    expect(internals.vallisneriaUptakePointScratch).toBe(
      identities.uptakePoint,
    );
    expect(internals.vallisneriaCanopyBoundsScratch).toBe(identities.bounds);
    expect(internals.vallisneriaPhysiologyRatesScratch).toBe(
      identities.physiologyRates,
    );
    for (const cell of internals.allCells()) {
      expect(cell.biomass).toBe(biomassByCell.get(cell.id));
    }
  });
});
