import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  SpeciesBiomass,
  StructureDefinitionId,
  SurfaceKind,
} from '../src/simulation/types';

interface DebugCell {
  id: string;
  ownerId: string;
  surfaceKind: SurfaceKind;
  light: number;
  biomass: SpeciesBiomass;
  localNeighborIds: string[];
  neighborIds: string[];
}

interface DebugWorld {
  crossConnectionsDirty: boolean;
  createStructure(
    definitionId: StructureDefinitionId,
    x: number,
    y: number,
    angle?: number,
    locked?: boolean,
  ): unknown;
  rebuildCrossConnections(): void;
  allCells(): DebugCell[];
  stepGrowth(deltaSeconds: number): void;
}

const denseWorld = (structureCount: number): {
  world: SimulationWorld;
  internals: DebugWorld;
  cells: DebugCell[];
} => {
  const world = new SimulationWorld('laboratory');
  const internals = world as unknown as DebugWorld;
  // Deliberately overlap ecology faces to reproduce the former worst case:
  // every cell used to retain every nearby cell from all other surfaces.
  for (let index = 0; index < structureCount; index += 1) {
    internals.createStructure('flat-stone', 600, 500, 0, true);
  }
  internals.crossConnectionsDirty = true;
  internals.rebuildCrossConnections();
  return { world, internals, cells: internals.allCells() };
};

describe('bounded cross-surface colony bridges', () => {
  it('keeps local grid links and caps symmetric cross-surface links in a dense stack', () => {
    const { cells } = denseWorld(12);
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    let crossLinkEntries = 0;

    for (const cell of cells) {
      expect(cell.neighborIds).toEqual(expect.arrayContaining(cell.localNeighborIds));
      const crossNeighbors = cell.neighborIds.filter(
        (neighborId) => byId.get(neighborId)?.ownerId !== cell.ownerId,
      );
      expect(crossNeighbors.length).toBeLessThanOrEqual(4);
      crossLinkEntries += crossNeighbors.length;
      for (const neighborId of crossNeighbors) {
        expect(byId.get(neighborId)?.neighborIds).toContain(cell.id);
      }
    }

    expect(crossLinkEntries).toBeGreaterThan(0);
    expect(crossLinkEntries).toBeLessThanOrEqual(cells.length * 4);
  });

  it('moves biomass across a bridge without creating biomass at the source', () => {
    const { internals, cells } = denseWorld(2);
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const source = cells.find((cell) => cell.neighborIds.some(
      (neighborId) => byId.get(neighborId)?.ownerId !== cell.ownerId,
    ));
    expect(source).toBeDefined();
    if (!source) throw new Error('dense fixture did not create a cross-surface bridge');
    const receiver = source.neighborIds
      .map((neighborId) => byId.get(neighborId))
      .find((cell): cell is DebugCell => Boolean(cell && cell.ownerId !== source.ownerId));
    expect(receiver).toBeDefined();
    if (!receiver) throw new Error('dense fixture did not find the bridged receiver');

    const neighborIds = new Map(cells.map((cell) => [cell.id, [...cell.neighborIds]]));
    for (const cell of cells) {
      cell.light = 38;
      cell.biomass = { oedogonium: 0, nitzschia: 0 };
      cell.neighborIds = [];
    }
    source.biomass.nitzschia = 0.28;
    internals.stepGrowth(1);
    const isolatedSourceBiomass = source.biomass.nitzschia;
    const isolatedTotal = cells.reduce(
      (total, cell) => total + cell.biomass.nitzschia,
      0,
    );

    for (const cell of cells) {
      cell.biomass = { oedogonium: 0, nitzschia: 0 };
      cell.neighborIds = [...(neighborIds.get(cell.id) ?? [])];
    }
    source.biomass.nitzschia = 0.28;
    internals.stepGrowth(1);

    const connectedTotal = cells.reduce(
      (total, cell) => total + cell.biomass.nitzschia,
      0,
    );
    expect(receiver.biomass.nitzschia).toBeGreaterThan(0);
    expect(source.biomass.nitzschia).toBeLessThan(isolatedSourceBiomass);
    // Transfers run through several double-precision sums before the final
    // cell clamp.  A few millionths are numerical ordering noise, not created
    // colony mass; keep the conservation guard well below visible biomass.
    expect(Math.abs(connectedTotal - isolatedTotal)).toBeLessThan(0.00001);
  });
});
