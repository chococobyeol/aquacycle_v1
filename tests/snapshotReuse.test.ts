import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('simulation snapshot reuse', () => {
  it('updates the worker snapshot graph in place across long-running publications', () => {
    const world = new SimulationWorld('mission-7');
    const snapshot = world.snapshot();
    const identities = {
      root: snapshot,
      structures: snapshot.structures,
      firstStructure: snapshot.structures[0],
      cells: snapshot.cells,
      firstCell: snapshot.cells[0],
      firstBiomass: snapshot.cells[0].biomass,
      lightValues: snapshot.lightField.values,
      biogeochemistry: snapshot.biogeochemistry,
      water: snapshot.biogeochemistry.water,
      nutrients: snapshot.biogeochemistry.water.nutrients,
      transport: snapshot.biogeochemistry.transport,
      temperature: snapshot.biogeochemistry.transport.temperature,
      eventTotals: snapshot.animalPopulationEventTotals,
      deathsByCause: snapshot.animalPopulationEventTotals.deathsByCause,
    };
    const initialRevision = snapshot.revision;

    for (let generation = 0; generation < 200; generation += 1) {
      expect(world.snapshot(snapshot)).toBe(snapshot);
    }

    expect(snapshot.revision).toBe(initialRevision + 200);
    expect(snapshot).toBe(identities.root);
    expect(snapshot.structures).toBe(identities.structures);
    expect(snapshot.structures[0]).toBe(identities.firstStructure);
    expect(snapshot.cells).toBe(identities.cells);
    expect(snapshot.cells[0]).toBe(identities.firstCell);
    expect(snapshot.cells[0].biomass).toBe(identities.firstBiomass);
    expect(snapshot.lightField.values).toBe(identities.lightValues);
    expect(snapshot.biogeochemistry).toBe(identities.biogeochemistry);
    expect(snapshot.biogeochemistry.water).toBe(identities.water);
    expect(snapshot.biogeochemistry.water.nutrients).toBe(identities.nutrients);
    expect(snapshot.biogeochemistry.transport).toBe(identities.transport);
    expect(snapshot.biogeochemistry.transport.temperature).toBe(
      identities.temperature,
    );
    expect(snapshot.animalPopulationEventTotals).toBe(identities.eventTotals);
    expect(snapshot.animalPopulationEventTotals.deathsByCause).toBe(
      identities.deathsByCause,
    );
  });

  it('keeps the default snapshot API immutable for callers that retain history', () => {
    const world = new SimulationWorld('mission-1');
    const first = world.snapshot();
    const second = world.snapshot();

    expect(second).not.toBe(first);
    expect(second.cells).not.toBe(first.cells);
    expect(second.biogeochemistry.water.nutrients).not.toBe(
      first.biogeochemistry.water.nutrients,
    );
  });
});
