import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SimulationSaveData } from '../src/simulation/types';

interface FixtureOnlyReport {
  fixture: {
    vallisneriaInitialRootXs: number[];
    tank: {
      width: number;
    };
    structures: Record<string, number>;
    structurePlacements: Array<{
      definitionId: string;
      x: number;
      y: number;
    }>;
    seeds: Record<string, number>;
    vallisneriaPlantingBeds: Array<{
      minimumX: number;
      maximumX: number;
      tankFraction: number;
      initialRootXs: number[];
      initialRootsOutside: number;
      leftBoundary: {
        kind: string;
        definitionId: string;
        rightmostX: number;
        gapToBed: number;
      };
      rightBoundary: {
        kind: string;
        x: number;
      };
    }>;
  };
  acceptance: {
    passed: boolean;
    failedCount: number;
    checks: Array<{
      label: string;
      passed: boolean;
    }>;
  };
}

const runFixtureOnly = (): FixtureOnlyReport => {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const output = execFileSync(
    process.execPath,
    [
      path.join(
        repositoryRoot,
        'node_modules/vite-node/vite-node.mjs',
      ),
      path.join(repositoryRoot, 'scripts/verifyMission8FoodWeb.ts'),
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        MISSION8_VERIFY_FIXTURE_ONLY: 'true',
      },
    },
  );
  return JSON.parse(output) as FixtureOnlyReport;
};

const loadEstablishedPreyPreset = (): SimulationSaveData => {
  const presetPath = fileURLToPath(
    new URL('../scripts/fixtures/mission8-established-prey.json', import.meta.url),
  );
  return JSON.parse(readFileSync(presetPath, 'utf8')) as SimulationSaveData;
};

describe('Mission 8 food-web fixture', () => {
  it('clusters the initial Vallisneria in one right-side planting area instead of tank-wide', () => {
    const report = runFixtureOnly();
    const fixture = report.fixture;
    const [bed] = fixture.vallisneriaPlantingBeds;

    expect(report.acceptance).toMatchObject({
      passed: true,
      failedCount: 0,
    });
    expect(fixture.vallisneriaInitialRootXs).toEqual(bed.initialRootXs);
    expect(bed).toBeDefined();
    expect(fixture.vallisneriaPlantingBeds).toHaveLength(1);
    expect(bed.initialRootXs).toHaveLength(6);
    expect(bed.initialRootsOutside).toBe(0);
    expect(bed.tankFraction).toBeLessThanOrEqual(0.42);
    expect(bed.minimumX / fixture.tank.width).toBeGreaterThan(0.58);
    expect(bed.initialRootXs.every((x) =>
      x >= bed.minimumX && x <= bed.maximumX)).toBe(true);
    expect(
      Math.min(...bed.initialRootXs) / fixture.tank.width,
    ).toBeGreaterThan(0.68);
    expect(
      (Math.max(...bed.initialRootXs) - Math.min(...bed.initialRootXs)) /
        fixture.tank.width,
    ).toBeLessThan(0.25);
    expect(fixture.seeds.vallisneria).toBe(6);
  }, 15_000);

  it('places a real shading stone at the authored bed edge without treating it as a runner wall', () => {
    const report = runFixtureOnly();
    const [bed] = report.fixture.vallisneriaPlantingBeds;

    expect(bed.leftBoundary).toMatchObject({
      kind: 'structure',
      definitionId: 'tall-stone',
      gapToBed: 0,
    });
    expect(bed.leftBoundary.rightmostX).toBeCloseTo(bed.minimumX, 8);
    expect(bed.rightBoundary).toEqual({
      kind: 'tank-wall',
      x: report.fixture.tank.width,
    });
    expect(report.fixture.structures).toMatchObject({
      'flat-stone': 1,
      'round-stone': 1,
      'tall-stone': 3,
      'small-flat-stone': 2,
      'small-wedge-stone': 0,
    });
    const placements = report.fixture.structurePlacements;
    const normalizedXs = placements.map((placement) =>
      placement.x / report.fixture.tank.width);
    expect(placements.map((placement) => placement.definitionId)).toEqual([
      'flat-stone',
      'tall-stone',
      'tall-stone',
      'small-flat-stone',
      'small-flat-stone',
      'round-stone',
      'tall-stone',
    ]);
    expect(normalizedXs).toEqual([
      expect.closeTo(0.06, 2),
      expect.closeTo(0.145, 2),
      expect.closeTo(0.255, 2),
      expect.closeTo(0.34, 2),
      expect.closeTo(0.39, 2),
      expect.closeTo(0.515, 2),
      expect.closeTo(0.59, 2),
    ]);
    expect(report.acceptance.checks.every((check) => check.passed)).toBe(true);
  }, 15_000);

  it('loads the frozen established-prey preset without rebuilding the prey community', () => {
    const preset = loadEstablishedPreyPreset();
    const daphnia = preset.animals.filter((animal) =>
      animal.speciesId === 'daphnia');
    const adultDaphnia = daphnia.filter((animal) =>
      animal.lifeStage === 'adult');
    const shrimp = preset.animals.filter((animal) =>
      animal.speciesId === 'cherry-shrimp');
    const ricefish = preset.animals.filter((animal) =>
      animal.speciesId === 'japanese-ricefish');
    const vallisneria = preset.seedPlacements.filter((placement) =>
      placement.speciesId === 'vallisneria');

    expect(preset).toMatchObject({
      version: 1,
      scenarioId: 'mission-8',
      tankType: 'long',
      savedPhase: 'paused',
      hasStarted: true,
      animalPopulationEventSequence: 0,
      animalInventoryUsed: {
        'japanese-ricefish': 0,
      },
    });
    expect(preset.animalPopulationEvents).toEqual([]);
    expect(preset.carcasses).toEqual([]);
    expect(ricefish).toHaveLength(0);
    expect(daphnia.length).toBeGreaterThanOrEqual(120);
    expect(adultDaphnia.length).toBeGreaterThanOrEqual(30);
    expect(Math.max(...daphnia.map((animal) => animal.generation ?? 0)))
      .toBeGreaterThanOrEqual(2);
    expect(shrimp.length).toBeGreaterThanOrEqual(8);
    expect(vallisneria.length).toBeGreaterThanOrEqual(6);

    const world = new SimulationWorld('mission-8', 'long');
    expect(() => world.loadSaveData(preset)).not.toThrow();
    const restored = world.exportSaveData();
    expect(restored.elapsedSeconds).toBe(preset.elapsedSeconds);
    expect(restored.animals).toHaveLength(preset.animals.length);
    expect(restored.animals.some((animal) =>
      animal.speciesId === 'japanese-ricefish')).toBe(false);
  });
});
