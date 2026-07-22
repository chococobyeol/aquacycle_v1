import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';

const point = { x: 600, y: 620 };

const site = (decomposer: number, nitrifier: number): BiofilmReactionSite => ({
  point,
  biofilm: { decomposer, nitrifier },
});

describe('active biogeochemistry', () => {
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
    ledger.recordAnimalMetabolism(bottom, 0, 10, 1);
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
});
