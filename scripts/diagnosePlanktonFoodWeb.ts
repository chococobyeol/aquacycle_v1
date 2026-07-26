import { BiogeochemistryLedger, WATER_COLUMNS, WATER_ROWS } from '../src/simulation/biogeochemistry';
import { GROUND_Y, TANK_WIDTH, WATER_TOP, type PlanktonSnapshot } from '../src/simulation/types';

const centre = { x: TANK_WIDTH / 2, y: (WATER_TOP + GROUND_Y) / 2 };
const light = Array.from({ length: WATER_COLUMNS * WATER_ROWS }, () => 72);

const run = (
  label: string,
  options: { phytoplankton: number; decomposer: number; daphnia: number },
  durationSeconds = 600,
): PlanktonSnapshot => {
  const ledger = new BiogeochemistryLedger({
    effectsEnabled: true,
    initial: {
      organicMatter: 6,
      toxicWaste: 0.8,
      nutrients: 28,
      oxygen: 82,
    },
    initialTemperature: 23.5,
  });
  ledger.setTransportLight(light);
  ledger.addPlankton(centre, 'phytoplankton', options.phytoplankton);
  ledger.addPlanktonicDecomposer(centre, options.decomposer);
  ledger.addPlankton(centre, 'daphnia', options.daphnia);
  for (let second = 0; second < durationSeconds; second += 1) {
    ledger.beginStep(1);
    ledger.advanceTemperature(1, 22);
    ledger.advance(1, []);
  }
  const plankton = ledger.snapshot().plankton;
  console.log(label, {
    phytoplankton: plankton.phytoplanktonBiomass.toFixed(3),
    decomposer: plankton.planktonicDecomposerBiomass.toFixed(3),
    juveniles: plankton.daphniaJuvenileBiomass.toFixed(3),
    adults: plankton.daphniaAdultBiomass.toFixed(3),
    secondGenerationBirths:
      plankton.cumulativeEvents.secondGenerationBirths.toFixed(3),
    approximateCount: plankton.approximateDaphniaCount,
  });
  return plankton;
};

run('세균만', { phytoplankton: 0, decomposer: 2.4, daphnia: 0.72 });
run('식물플랑크톤만', { phytoplankton: 2.2, decomposer: 0, daphnia: 0.72 });
run('혼합 먹이 · 장주기', { phytoplankton: 2.2, decomposer: 1.2, daphnia: 0.72 }, 1_800);
