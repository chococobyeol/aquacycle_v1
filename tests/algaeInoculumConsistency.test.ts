import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  SCENARIOS,
  SURFACE_ALGAE_INOCULUM_BIOMASS,
} from '../src/simulation/config';
import type { ScenarioId, SpeciesId } from '../src/simulation/types';

const SURFACE_ALGAE: SpeciesId[] = ['oedogonium', 'nitzschia'];

describe('surface algae inoculum consistency', () => {
  it('uses one real biomass dose in every mission and the laboratory', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      const speciesId = SURFACE_ALGAE.find((species) =>
        scenario.allowedSpecies.includes(species),
      );
      if (!speciesId) continue;

      const world = new SimulationWorld(scenario.id as ScenarioId);
      const cell = world.snapshot().cells.find(
        (candidate) => candidate.surfaceKind === 'substrate',
      );
      expect(cell, `${scenario.id} substrate`).toBeDefined();
      world.handle({ type: 'pick-seed', speciesId, point: cell! });
      world.handle({ type: 'drop-held', point: cell! });

      const placed = world.snapshot().cells.find(
        (candidate) => candidate.id === cell!.id,
      );
      expect(
        placed?.biomass[speciesId],
        `${scenario.id} ${speciesId}`,
      ).toBeCloseTo(SURFACE_ALGAE_INOCULUM_BIOMASS, 8);
    }
  });
});
