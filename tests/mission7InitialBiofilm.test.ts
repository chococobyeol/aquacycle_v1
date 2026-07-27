import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { SCENARIOS } from '../src/simulation/config';

const totalBiofilm = (world: SimulationWorld) =>
  world.snapshot().cells.reduce(
    (total, cell) => ({
      decomposer: total.decomposer + cell.biofilm.decomposer,
      nitrifier: total.nitrifier + cell.biofilm.nitrifier,
    }),
    { decomposer: 0, nitrifier: 0 },
  );

describe('mission 7 explicit cycling cultures', () => {
  it('starts with an empty substrate and unlimited player-supplied cultures', () => {
    const world = new SimulationWorld('mission-7');

    expect(totalBiofilm(world)).toEqual({
      decomposer: 0,
      nitrifier: 0,
    });
    expect(SCENARIOS['mission-7'].waterCycle?.microbeBudget).toEqual({
      decomposer: null,
      nitrifier: null,
    });
    expect(world.snapshot().remainingMicrobes).toEqual({
      decomposer: null,
      nitrifier: null,
    });
  });

  it('does not add resident films to earlier water-cycle missions', () => {
    const world = new SimulationWorld('mission-6');

    expect(totalBiofilm(world)).toEqual({
      decomposer: 0,
      nitrifier: 0,
    });
  });

  it('restores explicitly added films without seeding them a second time', () => {
    const world = new SimulationWorld('mission-7');
    const exposed = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) => left.y - right.y || left.x - right.x);
    const inoculationPoint = exposed[0]!;

    world.handle({
      type: 'pick-biofilm',
      guildId: 'decomposer',
      point: inoculationPoint,
    });
    world.handle({ type: 'drop-held', point: inoculationPoint });
    const inoculatedDecomposer = totalBiofilm(world).decomposer;
    expect(inoculatedDecomposer).toBeGreaterThan(0);
    expect(totalBiofilm(world).nitrifier).toBe(0);

    world.handle({ type: 'start' });
    const saved = world.exportSaveData();
    const referenceBefore = saved.materialReference;
    expect(saved.microbeInventoryUsed).toEqual({
      decomposer: 1,
      nitrifier: 0,
    });

    const restored = new SimulationWorld('mission-1');
    restored.loadSaveData(saved);
    const resaved = restored.exportSaveData();

    expect(totalBiofilm(restored).decomposer)
      .toBeCloseTo(inoculatedDecomposer, 12);
    expect(totalBiofilm(restored).nitrifier).toBe(0);
    expect(resaved.microbeInventoryUsed).toEqual(saved.microbeInventoryUsed);
    expect(resaved.materialReference).toEqual(referenceBefore);
    const balance = restored.snapshot().biogeochemistry.materialBalance;
    expect(balance).toMatchObject({
      referenceNitrogen: referenceBefore?.nitrogen,
      referenceCarbon: referenceBefore?.carbon,
      referenceOxygenEquivalent: referenceBefore?.oxygenEquivalent,
    });
    expect(Math.abs(balance.nitrogenDriftRatio)).toBeLessThan(1e-12);
    expect(Math.abs(balance.carbonDriftRatio)).toBeLessThan(1e-12);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio)).toBeLessThan(1e-12);
  });
});
