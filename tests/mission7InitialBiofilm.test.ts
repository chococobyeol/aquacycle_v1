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

describe('mission 7 seasoned substrate', () => {
  it('distributes the declared resident films only across the exposed substrate row', () => {
    const world = new SimulationWorld('mission-7');
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    const exposedY = Math.min(...substrate.map((cell) => cell.y));
    const exposed = substrate.filter((cell) => cell.y === exposedY);
    const buried = substrate.filter((cell) => cell.y !== exposedY);
    const configured = SCENARIOS['mission-7'].waterCycle?.initialBiofilm;

    expect(configured).toEqual({ decomposer: 0.36, nitrifier: 0.36 });
    expect(exposed).toHaveLength(120);
    expect(exposed.every(
      (cell) => cell.biofilm.decomposer > 0 && cell.biofilm.nitrifier > 0,
    )).toBe(true);
    expect(buried.every(
      (cell) => cell.biofilm.decomposer === 0 && cell.biofilm.nitrifier === 0,
    )).toBe(true);
    expect(totalBiofilm(world).decomposer).toBeCloseTo(0.36, 12);
    expect(totalBiofilm(world).nitrifier).toBeCloseTo(0.36, 12);
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

  it('restores saved resident and added films without seeding them a second time', () => {
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
    expect(totalBiofilm(world).decomposer).toBeCloseTo(0.54, 12);

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

    expect(totalBiofilm(restored).decomposer).toBeCloseTo(0.54, 12);
    expect(totalBiofilm(restored).nitrifier).toBeCloseTo(0.36, 12);
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
