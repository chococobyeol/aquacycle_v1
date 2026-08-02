import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';
import {
  MICROBE_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import { thetaTemperatureFactor } from '../src/simulation/temperatureResponse';

const point = { x: 600, y: 620 };

const site = (decomposer: number, nitrifier: number): BiofilmReactionSite => ({
  point,
  biofilm: { decomposer, nitrifier },
});

describe('active biogeochemistry', () => {
  it('reuses local vector and plankton samples while scalar accessors keep the same cell lookup', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 3, toxicWaste: 1.5, nutrients: 50, oxygen: 76 },
    });
    ledger.addPlankton(point, 'phytoplankton', 0.8);
    ledger.addPlankton(point, 'daphnia', 0.3);
    ledger.addPlanktonicDecomposer(point, 0.2);

    const expectedPlankton = ledger.planktonAt(point);
    const planktonReuse = {
      phytoplankton: Number.NaN,
      planktonicDecomposer: Number.NaN,
      daphniaJuveniles: Number.NaN,
      daphniaAdults: Number.NaN,
    };
    expect(ledger.planktonAt(point, planktonReuse)).toBe(planktonReuse);
    expect(planktonReuse).toEqual(expectedPlankton);

    const velocityReuse = { x: Number.NaN, y: Number.NaN };
    expect(ledger.velocityAt(point, velocityReuse)).toBe(velocityReuse);
    expect(velocityReuse).toEqual(ledger.velocityAt(point));

    for (const samplePoint of [
      point,
      { x: -100, y: -100 },
      { x: 10_000, y: 10_000 },
    ]) {
      const quality = ledger.sampleAt(samplePoint);
      expect(ledger.oxygenAt(samplePoint)).toBe(quality.oxygen);
      expect(ledger.toxicWasteAt(samplePoint)).toBe(quality.toxicWaste);
    }
  });

  it('lets algae assimilate local ammonium but never consumes organic detritus directly', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 3, toxicWaste: 1.5, nutrients: 50, oxygen: 76 },
    });
    const before = ledger.sampleAt(point);

    expect(ledger.commitAlgaeProduction(point, 1)).toBeGreaterThan(0);
    const after = ledger.sampleAt(point);

    expect(after.toxicWaste).toBeLessThan(before.toxicWaste);
    expect(after.nutrients).toBeLessThan(before.nutrients);
    expect(after.organicMatter).toBe(before.organicMatter);
  });

  it('can withdraw rooted-plant resources at one point while releasing oxygen at a leaf', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 3, toxicWaste: 1.5, nutrients: 50, oxygen: 50 },
    });
    const root = { x: 120, y: 610 };
    const leaf = { x: 1_080, y: 220 };
    const rootBefore = ledger.sampleAt(root);
    const leafBefore = ledger.sampleAt(leaf);

    expect(ledger.commitAlgaeProduction(root, 1, leaf)).toBeGreaterThan(0);

    const rootAfter = ledger.sampleAt(root);
    const leafAfter = ledger.sampleAt(leaf);
    expect(rootAfter.nutrients).toBeLessThan(rootBefore.nutrients);
    expect(leafAfter.oxygen).toBeGreaterThan(leafBefore.oxygen);
    expect(rootAfter.oxygen).toBeCloseTo(rootBefore.oxygen, 10);
  });

  it('stores local organism effects in the addressed 36 by 20 water cell', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 3, toxicWaste: 1.5, nutrients: 50, oxygen: 76 },
    });
    const affected = { x: 120, y: 300 };
    const distant = { x: 1080, y: 300 };

    ledger.beginStep();
    ledger.recordAnimalMetabolism(affected, 1, 0.5, 1);
    ledger.advance(1, []);

    expect(ledger.sampleAt(affected).organicMatter)
      .toBeGreaterThan(ledger.sampleAt(distant).organicMatter);
    expect(ledger.sampleAt(affected).toxicWaste)
      .toBeGreaterThan(ledger.sampleAt(distant).toxicWaste);
    expect(ledger.sampleAt(affected).oxygen)
      .toBeLessThan(ledger.sampleAt(distant).oxygen);
    expect(ledger.snapshot().water.organicMatter).toHaveLength(36 * 20);
  });

  it('does not delete animal biomass when oxygen cannot support respiration', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 0, nutrients: 20, oxygen: 0 },
    });
    const before = ledger.materialState();

    expect(ledger.recordAnimalRespiration(point, 0.5)).toBe(0);
    const assimilated = ledger.recordAnimalFeeding(point, 1);
    const after = ledger.materialState();

    expect(assimilated).toBeCloseTo(0.58, 12);
    expect(after.detritus).toBeCloseTo(0.42, 12);
    expect(after.dissolvedInorganicCarbon).toBeCloseTo(
      before.dissolvedInorganicCarbon,
      12,
    );
    expect(after.toxicWaste).toBeCloseTo(before.toxicWaste, 12);
  });

  it('separates feeding from continuous oxygen-consuming animal respiration', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 1, nutrients: 20, oxygen: 76 },
    });
    const beforeFeeding = ledger.materialState();

    expect(ledger.recordAnimalFeeding(point, 1, 'shrimp')).toBeCloseTo(0.58, 12);
    const afterFeeding = ledger.materialState();
    expect(afterFeeding.detritus - beforeFeeding.detritus).toBeCloseTo(0.42, 12);
    expect(afterFeeding.dissolvedOxygen).toBeCloseTo(
      beforeFeeding.dissolvedOxygen,
      12,
    );
    expect(afterFeeding.dissolvedInorganicCarbon).toBeCloseTo(
      beforeFeeding.dissolvedInorganicCarbon,
      12,
    );
    expect(afterFeeding.toxicWaste).toBeCloseTo(
      beforeFeeding.toxicWaste,
      12,
    );

    expect(ledger.recordAnimalRespiration(point, 0.1)).toBeCloseTo(0.1, 12);
    const afterRespiration = ledger.materialState();
    expect(afterRespiration.dissolvedOxygen)
      .toBeLessThan(afterFeeding.dissolvedOxygen);
    expect(afterRespiration.dissolvedInorganicCarbon)
      .toBeGreaterThan(afterFeeding.dissolvedInorganicCarbon);
    expect(afterRespiration.toxicWaste)
      .toBeGreaterThan(afterFeeding.toxicWaste);
  });

  it('returns the indigestible share of low-quality film to detritus', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 1, nutrients: 20, oxygen: 76 },
    });
    const before = ledger.materialState();

    const assimilated = ledger.recordAnimalFeeding(
      point,
      1,
      'shrimp',
      0.45,
    );
    const after = ledger.materialState();

    expect(assimilated).toBeCloseTo(0.58 * 0.45, 12);
    expect(after.detritus - before.detritus).toBeCloseTo(
      1 - 0.58 * 0.45,
      12,
    );
  });

  it('does not charge Daphnia a fixed respiration pulse at ingestion', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 1, nutrients: 20, oxygen: 76 },
    });
    const before = ledger.materialState();

    const assimilated = ledger.recordDaphniaFeeding(point, 0.6, 0.4);
    const after = ledger.materialState();

    expect(assimilated).toBeGreaterThan(0);
    expect(after.detritus - before.detritus)
      .toBeCloseTo(1 - assimilated, 12);
    expect(after.dissolvedOxygen).toBeCloseTo(before.dissolvedOxygen, 12);
    expect(after.dissolvedInorganicCarbon)
      .toBeCloseTo(before.dissolvedInorganicCarbon, 12);
    expect(after.toxicWaste).toBeCloseTo(before.toxicWaste, 12);
  });

  it('makes an early inoculation shrink when both microbial foods are scarce', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0.2, toxicWaste: 0.1, nutrients: 40, oxygen: 76 },
    });
    const film = site(0.2, 0.2);

    ledger.beginStep();
    ledger.advance(30, [film]);

    expect(film.biofilm.decomposer).toBeLessThan(0.2);
    expect(film.biofilm.nitrifier).toBeLessThan(0.2);
    expect(ledger.microbeNetGrowthAt('decomposer', point)).toBeLessThan(0);
    expect(ledger.microbeNetGrowthAt('nitrifier', point)).toBeLessThan(0);
  });

  it('couples decomposer uptake to organic matter, oxygen and toxic waste', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 24, toxicWaste: 0, nutrients: 20, oxygen: 80 },
    });
    const film = site(0.35, 0);
    const before = ledger.snapshot().average;
    const localOxygenBefore = ledger.sampleAt(point).oxygen;

    ledger.beginStep();
    ledger.advance(1, [film]);
    const after = ledger.snapshot().average;

    expect(after.organicMatter).toBeLessThan(before.organicMatter);
    expect(after.toxicWaste).toBeGreaterThan(before.toxicWaste);
    expect(ledger.sampleAt(point).oxygen).toBeLessThan(localOxygenBefore);
    expect(film.biofilm.decomposer).toBeGreaterThan(0.35);
  });

  it('couples nitrifier uptake to toxic waste, oxygen and nutrients', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 24, nutrients: 5, oxygen: 80 },
    });
    const film = site(0, 0.35);
    const before = ledger.sampleAt(point);

    ledger.beginStep();
    ledger.advance(1, [film]);
    const after = ledger.sampleAt(point);

    expect(after.toxicWaste).toBeLessThan(before.toxicWaste);
    expect(after.nutrients).toBeGreaterThan(before.nutrients);
    expect(after.oxygen).toBeLessThan(before.oxygen);
    expect(film.biofilm.nitrifier).toBeGreaterThan(0.35);
  });

  it('turns an oxygenated nitrifier film from loss to growth inside the mission-5 ammonium band', () => {
    const netGrowthAt = (toxicWaste: number): number => {
      const ledger = new BiogeochemistryLedger({
        effectsEnabled: true,
        initial: { organicMatter: 0, toxicWaste, nutrients: 20, oxygen: 76 },
      });
      return ledger.microbeNetGrowthAt('nitrifier', point, 0.2);
    };

    const trace = netGrowthAt(0.1);
    const transition = netGrowthAt(0.5);
    const missionBand = netGrowthAt(0.8);
    const loaded = netGrowthAt(1.5);

    expect(trace).toBeLessThan(0);
    expect(transition).toBeGreaterThan(trace);
    expect(missionBand).toBeGreaterThan(0);
    expect(loaded).toBeGreaterThan(missionBand);
  });

  it('gives both guilds the same pre-reaction surface occupancy', () => {
    const initial = {
      organicMatter: 18,
      toxicWaste: 9,
      nutrients: 12,
      oxygen: 72,
    };
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial,
    });
    const film = site(0.45, 0.25);
    const deltaSeconds = 20;
    const kinetics = MICROBE_ECOLOGY_RULES.nitrifier;
    const activity =
      initial.toxicWaste / (initial.toxicWaste + kinetics.halfSaturation) *
      initial.oxygen / (initial.oxygen + kinetics.oxygenHalfSaturation);
    const temperatureFactor = thetaTemperatureFactor(
      ledger.temperatureAt(point),
      kinetics.referenceTemperature,
      kinetics.temperatureCoefficient,
    );
    const freeSurfaceAtStepStart = 1 - 0.45 - 0.25;
    const requested = 0.25 * kinetics.maximumUptake * activity *
      temperatureFactor * deltaSeconds;
    const expectedGrowth = requested * kinetics.biomassYield /
      WATER_CYCLE_RULES.biomassNitrogen * freeSurfaceAtStepStart;
    const decayRate = (
      kinetics.maintenanceDecayRate +
      kinetics.starvationDecayRate * (1 - activity)
    ) * temperatureFactor;
    const expectedDecay = 0.25 * (1 - Math.exp(-decayRate * deltaSeconds));

    ledger.beginStep();
    ledger.advance(deltaSeconds, [film]);

    expect(film.biofilm.nitrifier)
      .toBeCloseTo(0.25 + expectedGrowth - expectedDecay, 8);
  });

  it('lets an organic pulse grow decomposers before resource depletion makes them decline', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 8, toxicWaste: 0.4, nutrients: 30, oxygen: 82 },
    });
    const films = Array.from({ length: 24 }, (_, index) => ({
      point: { x: 25 + index * 50, y: 620 },
      biofilm: { decomposer: 0.05, nitrifier: 0 },
    }));
    const initialBiomass = films.reduce((sum, film) => sum + film.biofilm.decomposer, 0);
    let peakBiomass = initialBiomass;
    let organicAtPeak = ledger.snapshot().average.organicMatter;

    for (let second = 0; second < 1_800; second += 1) {
      ledger.beginStep();
      ledger.advance(1, films);
      const total = films.reduce((sum, film) => sum + film.biofilm.decomposer, 0);
      if (total > peakBiomass) {
        peakBiomass = total;
        organicAtPeak = ledger.snapshot().average.organicMatter;
      }
    }

    const finalBiomass = films.reduce((sum, film) => sum + film.biofilm.decomposer, 0);
    const finalOrganic = ledger.snapshot().average.organicMatter;
    // Only the bottom-adjacent fraction of the dissolved pulse is immediately
    // available to attached film, so the first bloom is bounded rather than an
    // artificial doubling of every inoculation site.
    expect(peakBiomass).toBeGreaterThan(initialBiomass * 1.12);
    expect(finalOrganic).toBeLessThan(organicAtPeak);
    expect(finalBiomass).toBeLessThan(peakBiomass * 0.8);

    ledger.beginStep();
    for (const film of films) ledger.recordAnimalMetabolism(film.point, 0, 3, 1);
    ledger.advance(1, films);
    let reboundBiomass = finalBiomass;
    for (let second = 0; second < 300; second += 1) {
      ledger.beginStep();
      ledger.advance(1, films);
      reboundBiomass = Math.max(
        reboundBiomass,
        films.reduce((sum, film) => sum + film.biofilm.decomposer, 0),
      );
    }
    expect(reboundBiomass).toBeGreaterThan(finalBiomass * 1.1);
  });

  it('carries dissolved waste from a bottom hot spot into the upper water without erasing locality', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 0, nutrients: 30, oxygen: 82 },
    });
    const bottom = { x: 600, y: 620 };
    const top = { x: 600, y: 90 };
    const light = Array.from({ length: WATER_COLUMNS * WATER_ROWS }, () => 0);
    light[(WATER_ROWS - 2) * WATER_COLUMNS + Math.floor(WATER_COLUMNS / 2)] = 100;
    ledger.setTransportEnvironment(light, []);

    ledger.beginStep();
    // Dissolved ammonia is released by actual continuous respiration, not by
    // merely ingesting a meal. The old fixture used zero maintenance and
    // still expected bite-time waste after that duplicate metabolism path had
    // been removed from the model.
    ledger.recordAnimalRespiration(bottom, 10);
    ledger.advanceTemperature(1, 22);
    ledger.advance(1, []);
    for (let second = 0; second < 119; second += 1) {
      ledger.beginStep();
      ledger.advanceTemperature(1, 22);
      ledger.advance(1, []);
    }

    expect(ledger.sampleAt(top).toxicWaste).toBeGreaterThan(0);
    expect(ledger.sampleAt(bottom).toxicWaste).toBeGreaterThan(
      ledger.sampleAt(top).toxicWaste,
    );
  });

  it('keeps every concentration and film finite and non-negative at fast steps', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 90, toxicWaste: 90, nutrients: 90, oxygen: 4 },
    });
    const films = Array.from({ length: 12 }, (_, index) => ({
      point: { x: 200 + index * 17, y: 620 },
      biofilm: { decomposer: 0.8, nitrifier: 0.8 },
    }));

    for (let step = 0; step < 600; step += 1) {
      ledger.beginStep();
      ledger.advance(1, films);
    }

    const snapshot = ledger.snapshot();
    for (const channel of [
      snapshot.water.organicMatter,
      snapshot.water.toxicWaste,
      snapshot.water.nutrients,
      snapshot.water.oxygen,
    ]) {
      expect(channel).toHaveLength(snapshot.water.columns * snapshot.water.rows);
      expect(channel.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true);
    }
    for (const film of films) {
      expect(Number.isFinite(film.biofilm.decomposer)).toBe(true);
      expect(Number.isFinite(film.biofilm.nitrifier)).toBe(true);
      expect(film.biofilm.decomposer).toBeGreaterThanOrEqual(0);
      expect(film.biofilm.nitrifier).toBeGreaterThanOrEqual(0);
      expect(film.biofilm.decomposer + film.biofilm.nitrifier).toBeLessThanOrEqual(1.000001);
    }
  });

  it('evaluates one biofilm step from a shared pre-reaction state regardless of site order', () => {
    const makeLedger = () => new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 18, toxicWaste: 9, nutrients: 12, oxygen: 72 },
    });
    const definitions: BiofilmReactionSite[] = [
      { point: { x: 520, y: 600 }, biofilm: { decomposer: 0.42, nitrifier: 0.08 } },
      { point: { x: 600, y: 600 }, biofilm: { decomposer: 0.24, nitrifier: 0.31 } },
      { point: { x: 680, y: 600 }, biofilm: { decomposer: 0.12, nitrifier: 0.46 } },
    ];
    const cloneSites = (items: BiofilmReactionSite[]) => items.map((item) => ({
      point: { ...item.point },
      biofilm: { ...item.biofilm },
    }));
    const forwardLedger = makeLedger();
    const reverseLedger = makeLedger();
    const forwardSites = cloneSites(definitions);
    const reverseSites = cloneSites([...definitions].reverse());

    forwardLedger.advance(4, forwardSites);
    reverseLedger.advance(4, reverseSites);

    expect(reverseLedger.materialState()).toEqual(forwardLedger.materialState());
    const byX = (items: BiofilmReactionSite[]) =>
      [...items].sort((left, right) => left.point.x - right.point.x);
    expect(byX(reverseSites)).toEqual(byX(forwardSites));
  });
});
