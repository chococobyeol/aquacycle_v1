import { describe, expect, it } from 'vitest';
import { ANIMALS, MICROBE_ECOLOGY_RULES } from '../src/simulation/config';
import {
  BiogeochemistryLedger,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';
import {
  closedOxygenWaterEquilibrium,
  freshwaterOxygenSolubilityMgL,
} from '../src/simulation/gasExchange';
import {
  interpolateTemperatureResponse,
  thetaTemperatureFactor,
} from '../src/simulation/temperatureResponse';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

const point = { x: 600, y: 620 };

const film = (): BiofilmReactionSite => ({
  point,
  biofilm: { decomposer: 0.3, nitrifier: 0.3 },
});

describe('temperature-coupled ecosystem responses', () => {
  it('matches the USGS Benson-Krause freshwater oxygen curve', () => {
    expect(freshwaterOxygenSolubilityMgL(0)).toBeCloseTo(14.62, 2);
    expect(freshwaterOxygenSolubilityMgL(20)).toBeCloseTo(9.09, 2);
    expect(freshwaterOxygenSolubilityMgL(30)).toBeCloseTo(7.56, 2);
    expect(freshwaterOxygenSolubilityMgL(10))
      .toBeGreaterThan(freshwaterOxygenSolubilityMgL(30));
  });

  it('gives colder water a larger closed-headspace oxygen share without creating oxygen', () => {
    const coldEquilibrium = closedOxygenWaterEquilibrium(152, 10);
    const warmEquilibrium = closedOxygenWaterEquilibrium(152, 30);
    expect(coldEquilibrium).toBeGreaterThan(76);
    expect(warmEquilibrium).toBeLessThan(76);

    const run = (temperature: number) => {
      const ledger = new BiogeochemistryLedger({
        effectsEnabled: true,
        initialTemperature: temperature,
        initial: { oxygen: 76, nutrients: 30 },
      });
      const before = ledger.materialState();
      ledger.advance(60, []);
      const after = ledger.materialState();
      return {
        water: after.dissolvedOxygen,
        drift: (after.dissolvedOxygen + after.headspaceOxygen) -
          (before.dissolvedOxygen + before.headspaceOxygen),
      };
    };

    const cold = run(10);
    const warm = run(30);
    expect(cold.water).toBeGreaterThan(warm.water);
    expect(Math.abs(cold.drift)).toBeLessThan(0.0001);
    expect(Math.abs(warm.drift)).toBeLessThan(0.0001);
  });

  it('uses the same WASP theta correction in microbial diagnostics and reactions', () => {
    const kinetics = MICROBE_ECOLOGY_RULES.decomposer;
    const coldFactor = thetaTemperatureFactor(
      16,
      kinetics.referenceTemperature,
      kinetics.temperatureCoefficient,
    );
    const warmFactor = thetaTemperatureFactor(
      28,
      kinetics.referenceTemperature,
      kinetics.temperatureCoefficient,
    );
    expect(coldFactor).toBeLessThan(1);
    expect(warmFactor).toBeGreaterThan(1);

    const ledgerAt = (temperature: number) => new BiogeochemistryLedger({
      effectsEnabled: true,
      initialTemperature: temperature,
      initial: { organicMatter: 24, toxicWaste: 18, nutrients: 10, oxygen: 82 },
    });
    const cold = ledgerAt(16);
    const warm = ledgerAt(28);
    expect(warm.microbeNetGrowthAt('decomposer', point))
      .toBeGreaterThan(cold.microbeNetGrowthAt('decomposer', point));
    expect(warm.microbeNetGrowthAt('nitrifier', point))
      .toBeGreaterThan(cold.microbeNetGrowthAt('nitrifier', point));

    const coldFilm = film();
    const warmFilm = film();
    cold.advance(1, [coldFilm]);
    warm.advance(1, [warmFilm]);
    expect(warmFilm.biofilm.decomposer - 0.3)
      .toBeGreaterThan(coldFilm.biofilm.decomposer - 0.3);
    expect(warmFilm.biofilm.nitrifier - 0.3)
      .toBeGreaterThan(coldFilm.biofilm.nitrifier - 0.3);
  });

  it('keeps shrimp metabolism and reproduction as separate temperature responses', () => {
    const profile = ANIMALS['cherry-shrimp'].temperature;
    const metabolismAt20 = thetaTemperatureFactor(
      20,
      profile.referenceTemperature,
      profile.metabolicTheta,
      profile.minimumMetabolicFactor,
      profile.maximumMetabolicFactor,
    );
    const metabolismAt28 = thetaTemperatureFactor(
      28,
      profile.referenceTemperature,
      profile.metabolicTheta,
      profile.minimumMetabolicFactor,
      profile.maximumMetabolicFactor,
    );
    expect(metabolismAt28).toBeGreaterThan(metabolismAt20);
    expect(interpolateTemperatureResponse(profile.reproductionCurve, 28))
      .toBeGreaterThan(interpolateTemperatureResponse(profile.reproductionCurve, 20));
    expect(interpolateTemperatureResponse(profile.reproductionCurve, 33)).toBe(0);
    expect(interpolateTemperatureResponse(profile.healthCurve, 28)).toBe(1);
  });

  it('publishes the same local shrimp factors that the ecology step consumes', () => {
    const world = new SimulationWorld('mission-5');
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 600, y: 600 },
    });
    world.handle({ type: 'drop-held', point: { x: 600, y: 600 } });
    const ledger = (world as unknown as { biogeochemistry: BiogeochemistryLedger })
      .biogeochemistry;
    const state = ledger.exportSaveState();
    state.transport!.temperature.fill(33);
    ledger.restoreSaveState(state, 33);

    world.handle({ type: 'start' });
    const snapshot = world.snapshot();
    const shrimp = snapshot.animals[0];

    expect(shrimp.temperature).toBeCloseTo(33, 4);
    expect(shrimp.metabolicTemperatureFactor).toBeGreaterThan(1);
    expect(shrimp.reproductionTemperatureFactor).toBe(0);
    expect(shrimp.thermalHealthSuitability).toBeLessThan(1);
    expect(snapshot.biogeochemistry.gasExchange.surfaceTemperature).toBeCloseTo(33, 4);
  });

  it('applies thermal health stress even before full water chemistry is enabled', () => {
    const world = new SimulationWorld('mission-4');
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 600, y: 600 },
    });
    world.handle({ type: 'drop-held', point: { x: 600, y: 600 } });
    const ledger = (world as unknown as { biogeochemistry: BiogeochemistryLedger })
      .biogeochemistry;
    expect(ledger.snapshot().effectsEnabled).toBe(false);
    const state = ledger.exportSaveState();
    state.transport!.temperature.fill(40);
    ledger.restoreSaveState(state, 40);

    world.handle({ type: 'start' });
    const started = world.snapshot();
    expect(started.phase).toBe('running');
    const initialHealth = started.animals[0].health;
    for (let step = 0; step < 10; step += 1) world.tick(0.1);

    const shrimp = world.snapshot().animals[0];
    expect(world.snapshot().elapsedSeconds).toBeGreaterThan(0);
    expect(shrimp.temperature).toBeGreaterThan(35);
    expect(shrimp.thermalHealthSuitability).toBe(0);
    expect(shrimp.health).toBeLessThan(initialHealth);
  });
});
