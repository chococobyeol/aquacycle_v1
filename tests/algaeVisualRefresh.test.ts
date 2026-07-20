import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  ALGAE_DENSITY_BLUR_PIXELS,
  ALGAE_DENSITY_FIELD_SCALE,
  ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL,
  ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL,
  ALGAE_PARTICLE_JITTER_SPAN,
  advanceAlgaeColonizationState,
  algaeCellVisualKey,
  algaeColonizationDetailSeed,
  algaeParticleAlpha,
  algaeParticleRadiusRatio,
  algaeVisualLevel,
} from '../src/renderer/tank/AquariumCanvas';
import {
  TANK_HEIGHT,
  TANK_WIDTH,
  type SurfaceCellSnapshot,
} from '../src/simulation/types';

const matureCell = (
  overrides: Partial<SurfaceCellSnapshot> = {},
): SurfaceCellSnapshot => ({
  id: 'substrate:cell-42',
  ownerId: 'substrate',
  ownerLabel: '바닥재',
  surfaceKind: 'substrate',
  index: 42,
  x: 612.5,
  y: 631.25,
  cellSize: 10,
  light: 64,
  biomass: {
    oedogonium: 0.72,
    nitzschia: 0.16,
  },
  targetEligible: true,
  ...overrides,
});

describe('algae visual refresh decisions', () => {
  it('keeps neighboring low-biomass brushes overlapping despite deterministic jitter', () => {
    const minimumVisibleLevel = 1;
    const combinedRadius = algaeParticleRadiusRatio(minimumVisibleLevel) * 2;
    const worstHorizontalCenterDistance = 1 + ALGAE_PARTICLE_JITTER_SPAN;

    expect(combinedRadius).toBeGreaterThan(worstHorizontalCenterDistance);
    expect(algaeParticleAlpha(minimumVisibleLevel)).toBeGreaterThanOrEqual(0.25);
    expect(algaeParticleAlpha(24)).toBe(1);
  });

  it('uses one bounded, interpolated field instead of presenting ecology cells at native resolution', () => {
    const fieldWidth = Math.round(TANK_WIDTH * ALGAE_DENSITY_FIELD_SCALE);
    const fieldHeight = Math.round(TANK_HEIGHT * ALGAE_DENSITY_FIELD_SCALE);
    const worldBlurRadius = ALGAE_DENSITY_BLUR_PIXELS / ALGAE_DENSITY_FIELD_SCALE;

    expect(fieldWidth).toBe(400);
    expect(fieldHeight).toBe(240);
    expect(fieldWidth * fieldHeight).toBeLessThanOrEqual(100_000);
    expect(worldBlurRadius).toBeGreaterThanOrEqual(2);
    expect(worldBlurRadius).toBeLessThan(4);
  });

  it('regenerates species detail after extinction without flickering while alive', () => {
    const settled = advanceAlgaeColonizationState(undefined, true);
    const stillAlive = advanceAlgaeColonizationState(settled, true);
    const extinct = advanceAlgaeColonizationState(stillAlive, false);
    const recolonizedState = advanceAlgaeColonizationState(extinct, true);
    const firstGeneration = algaeColonizationDetailSeed(
      'structure-1:cell-7',
      'oedogonium',
      1,
      0,
      0,
    );
    const sameLivingColony = algaeColonizationDetailSeed(
      'structure-1:cell-7',
      'oedogonium',
      1,
      0,
      0,
    );
    const recolonized = algaeColonizationDetailSeed(
      'structure-1:cell-7',
      'oedogonium',
      2,
      0,
      0,
    );

    expect(stillAlive).toBe(settled);
    expect(extinct.generation).toBe(1);
    expect(recolonizedState).toEqual({ active: true, generation: 2 });
    expect(sameLivingColony).toBe(firstGeneration);
    expect(recolonized).not.toBe(firstGeneration);
    expect(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL).toBeGreaterThanOrEqual(3);
    expect(ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL).toBeGreaterThanOrEqual(4);
  });

  it('collapses tiny mature-biomass changes into one visual level', () => {
    const levels = new Set<number>();
    for (let tick = 0; tick < 1_000; tick += 1) {
      levels.add(algaeVisualLevel(0.72 + tick * 0.0000001));
    }

    expect(levels.size).toBe(1);
    expect(algaeVisualLevel(0)).toBe(0);
    expect(algaeVisualLevel(0.0005)).toBe(0);
  });

  it('does not refresh a mature cell for ecology fields that cannot change its picture', () => {
    const baseline = matureCell();
    const tinyBiomassChange = matureCell({
      light: 11,
      targetEligible: false,
      biomass: {
        oedogonium: baseline.biomass.oedogonium + 0.00001,
        nitzschia: baseline.biomass.nitzschia + 0.00001,
      },
    });

    expect(algaeCellVisualKey(tinyBiomassChange)).toBe(
      algaeCellVisualKey(baseline),
    );
  });

  it('does refresh when visible density or cell geometry changes', () => {
    const baseline = matureCell();
    const visiblyDenser = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.9 },
    });
    const visiblyGrazed = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.48 },
    });
    const moved = matureCell({ x: baseline.x + 0.01 });

    expect(algaeVisualLevel(visiblyDenser.biomass.oedogonium)).not.toBe(
      algaeVisualLevel(baseline.biomass.oedogonium),
    );
    expect(algaeVisualLevel(visiblyGrazed.biomass.oedogonium)).toBeLessThan(
      algaeVisualLevel(baseline.biomass.oedogonium),
    );
    expect(algaeCellVisualKey(visiblyDenser)).not.toBe(
      algaeCellVisualKey(baseline),
    );
    expect(algaeCellVisualKey(visiblyGrazed)).not.toBe(
      algaeCellVisualKey(baseline),
    );
    expect(algaeCellVisualKey(moved)).not.toBe(algaeCellVisualKey(baseline));
  });
});
