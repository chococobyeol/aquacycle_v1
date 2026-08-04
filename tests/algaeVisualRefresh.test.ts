import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  ALGAE_BRUSH_MEMBRANE_RADIUS,
  ALGAE_BRUSH_SOFT_EDGE_PIXELS,
  ALGAE_BRUSH_TEXTURE_SIZE,
  ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL,
  ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL,
  ALGAE_PACKAGED_WASH_DARKEN_GAIN,
  ALGAE_PARTICLE_ALPHA_FLOOR,
  ALGAE_VISUAL_LEVEL_COUNT,
  ALGAE_VISUAL_SATURATION_BIOMASS,
  NITZSCHIA_VISUAL_STYLE,
  OEDOGONIUM_DENSITY_ALPHA,
  nitzschiaSpeckCount,
  advanceAlgaeColonizationState,
  algaeCellVisualKey,
  algaeColonizationDetailSeed,
  algaeDetailCount,
  algaeParticleAlpha,
  algaeParticleRadiusRatio,
  algaeSpeciesWashAlpha,
  algaeVisualRatio,
  algaeVisualLevel,
  oedogoniumFilamentCount,
  shouldTriggerShrimpGrazingPulse,
  surfaceAlgaeSpeciesShare,
} from '../src/renderer/tank/AquariumCanvas';
import {
  ALGAE_RENDER_TRACE_BIOMASS,
  ALGAE_VISIBLE_BIOMASS,
  SCENARIOS,
  SURFACE_ALGAE_INOCULUM_BIOMASS,
} from '../src/simulation/config';
import {
  SimulationWorld,
  SURFACE_FILM_DISPERSAL_TIME_SCALE,
} from '../src/simulation/SimulationWorld';
import {
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
  plantCanopyLight: null,
  biomass: {
    oedogonium: 0.72,
    nitzschia: 0.16,
    vallisneria: 0,
  },
  biofilm: { decomposer: 0, nitrifier: 0 },
  targetEligible: true,
  ...overrides,
});

describe('algae visual refresh decisions', () => {
  it('keeps a mature diatom film legible on substrate at the default fit zoom', () => {
    const substrate = [0x95, 0x78, 0x5a];
    const brush = NITZSCHIA_VISUAL_STYLE.brush;
    const effectiveAlpha = brush.alpha * NITZSCHIA_VISUAL_STYLE.substrateAlpha;
    const composite = [brush.red, brush.green, brush.blue].map(
      (channel, index) => substrate[index] + (channel - substrate[index]) * effectiveAlpha,
    );
    const colorDistance = Math.hypot(
      ...composite.map((channel, index) => channel - substrate[index]),
    );
    const averageSpeckDiameterAtDefaultZoom = (
      NITZSCHIA_VISUAL_STYLE.speck.radiusMin +
      NITZSCHIA_VISUAL_STYLE.speck.radiusSpan / 2
    ) * 2 * 0.84;

    expect(colorDistance).toBeGreaterThanOrEqual(16);
    expect(averageSpeckDiameterAtDefaultZoom).toBeGreaterThanOrEqual(1);
    expect(NITZSCHIA_VISUAL_STYLE.structureAlpha).toBeLessThan(
      NITZSCHIA_VISUAL_STYLE.substrateAlpha,
    );
    expect(NITZSCHIA_VISUAL_STYLE.structureAlpha).toBeGreaterThanOrEqual(0.58);
    expect(OEDOGONIUM_DENSITY_ALPHA).toBeGreaterThanOrEqual(0.86);
  });

  it('draws a new real colony as the packaged build\'s broad pale wash', () => {
    const minimumVisibleLevel = 1;

    expect(algaeParticleRadiusRatio(minimumVisibleLevel)).toBeGreaterThanOrEqual(0.69);
    expect(algaeParticleRadiusRatio(minimumVisibleLevel)).toBeLessThan(0.75);
    expect(ALGAE_PARTICLE_ALPHA_FLOOR).toBe(0.58);
    expect(algaeParticleAlpha(minimumVisibleLevel)).toBeGreaterThanOrEqual(0.59);
    expect(algaeParticleAlpha(minimumVisibleLevel)).toBeLessThan(0.6);
    expect(algaeParticleAlpha(ALGAE_VISUAL_LEVEL_COUNT)).toBe(1);
  });

  it('uses the packaged immutable brush geometry with one colour-only gain', () => {
    expect(ALGAE_BRUSH_TEXTURE_SIZE).toBe(96);
    expect(ALGAE_BRUSH_MEMBRANE_RADIUS).toBe(27);
    expect(ALGAE_BRUSH_SOFT_EDGE_PIXELS).toBe(10);
    expect(ALGAE_PACKAGED_WASH_DARKEN_GAIN).toBe(1.8);
  });

  it('renders a 99% Nitzschia cell as brown instead of letting trace Oedogonium cover it', () => {
    const nitzschiaDominant = matureCell({
      biomass: {
        oedogonium: 0.0001,
        nitzschia: 0.0099,
        vallisneria: 0,
      },
    });
    const nitzschiaShare = surfaceAlgaeSpeciesShare(
      nitzschiaDominant.biomass,
      'nitzschia',
    );
    const oedogoniumShare = surfaceAlgaeSpeciesShare(
      nitzschiaDominant.biomass,
      'oedogonium',
    );

    expect(nitzschiaShare).toBeCloseTo(0.99, 8);
    expect(oedogoniumShare).toBeCloseTo(0.01, 8);
    expect(algaeSpeciesWashAlpha(nitzschiaDominant, 'nitzschia')).toBeGreaterThan(
      algaeSpeciesWashAlpha(nitzschiaDominant, 'oedogonium') * 80,
    );
    expect(oedogoniumFilamentCount(
      nitzschiaDominant.id,
      algaeVisualLevel(nitzschiaDominant.biomass.oedogonium),
      nitzschiaDominant.biomass.oedogonium,
      oedogoniumShare,
    )).toBe(0);
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(nitzschiaDominant.biomass.nitzschia),
      nitzschiaDominant.biomass.nitzschia,
      nitzschiaShare,
    )).toBeGreaterThan(0);
  });

  it('refreshes Oedogonium presentation when only competing Nitzschia changes', () => {
    const baseline = matureCell({
      biomass: { oedogonium: 0.02, nitzschia: 0.02, vallisneria: 0 },
    });
    const nitzschiaIncrease = matureCell({
      biomass: { oedogonium: 0.02, nitzschia: 0.08, vallisneria: 0 },
    });

    expect(algaeCellVisualKey(nitzschiaIncrease)).not.toBe(
      algaeCellVisualKey(baseline),
    );
    expect(algaeSpeciesWashAlpha(nitzschiaIncrease, 'oedogonium')).toBeLessThan(
      algaeSpeciesWashAlpha(baseline, 'oedogonium'),
    );
  });

  it('shows one mission-1 starter dose as a readable footprint with sparse filaments', () => {
    const biomass = SURFACE_ALGAE_INOCULUM_BIOMASS;
    const level = algaeVisualLevel(biomass);
    const filaments = oedogoniumFilamentCount('starter-cell', level, biomass);

    expect(biomass).toBeLessThanOrEqual(0.15);
    expect(SCENARIOS['mission-1'].target?.type).toBe('coverage');
    if (SCENARIOS['mission-1'].target?.type === 'coverage') {
      expect(SCENARIOS['mission-1'].target.minBiomass)
        .toBe(ALGAE_RENDER_TRACE_BIOMASS);
    }
    expect(filaments).toBe(2);
    const effectiveWashAlpha = Math.min(
      1,
      0.52 * ALGAE_PACKAGED_WASH_DARKEN_GAIN,
    ) * OEDOGONIUM_DENSITY_ALPHA * algaeParticleAlpha(level);
    expect(effectiveWashAlpha).toBeGreaterThanOrEqual(0.28);
  });

  it('uses the same small Oedogonium dose for a fresh laboratory inoculation', () => {
    const world = new SimulationWorld('laboratory');
    const target = world.snapshot().cells.find(
      (cell) => cell.surfaceKind === 'substrate',
    );
    expect(target).toBeDefined();
    world.handle({
      type: 'pick-seed',
      speciesId: 'oedogonium',
      point: target!,
    });
    world.handle({ type: 'drop-held', point: target! });

    expect(world.snapshot().totalBiomass.oedogonium).toBeCloseTo(0.12, 8);
  });

  it('starts mission 2 and the laboratory with a sparse real diatom film', () => {
    const missionDose = SURFACE_ALGAE_INOCULUM_BIOMASS;
    expect(missionDose).toBe(0.12);
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(missionDose),
      missionDose,
    )).toBe(3);
    const target = SCENARIOS['mission-2'].target;
    expect(target?.type).toBe('biomass');
    if (target?.type === 'biomass') {
      expect(missionDose * 4).toBeLessThan(target.amount);
    }
  });

  it('removes crisp detail marks as a grazed colony loses biomass', () => {
    expect(algaeDetailCount(
      ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL,
      ALGAE_VISUAL_LEVEL_COUNT,
    ))
      .toBe(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL);
    expect(algaeDetailCount(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL, 8))
      .toBeLessThan(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL);
    expect(nitzschiaSpeckCount(1)).toBe(1);
    expect(nitzschiaSpeckCount(ALGAE_VISUAL_LEVEL_COUNT))
      .toBe(ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL);
    expect(nitzschiaSpeckCount(0))
      .toBe(0);
  });

  it('keeps the packaged sparse detail over a real dispersal trace', () => {
    const traceBiomass = ALGAE_VISIBLE_BIOMASS * 0.5;
    const starterBiomass = SURFACE_ALGAE_INOCULUM_BIOMASS;

    expect(nitzschiaSpeckCount(
      algaeVisualLevel(traceBiomass),
      traceBiomass,
    )).toBeGreaterThanOrEqual(1);
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(starterBiomass),
      starterBiomass,
    )).toBe(3);
    expect(nitzschiaSpeckCount(
      ALGAE_VISUAL_LEVEL_COUNT,
      ALGAE_VISUAL_SATURATION_BIOMASS,
    )).toBe(5);
  });

  it('uses one restrained identity filament per established low-level cell', () => {
    const frontCounts = Array.from({ length: 24 }, (_, index) =>
      oedogoniumFilamentCount(`front-cell-${index}`, 1));
    const visibleStrands = frontCounts.reduce((sum, count) => sum + count, 0);

    expect(visibleStrands).toBe(24);
    expect(frontCounts.every((count) => count === 1)).toBe(true);
    expect(oedogoniumFilamentCount('empty', 0)).toBe(0);
    expect(oedogoniumFilamentCount(
      'mature',
      ALGAE_VISUAL_LEVEL_COUNT,
    )).toBe(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL);
  });

  it('overlaps neighboring packaged brush sprites into one continuous film', () => {
    const traceRadius = algaeParticleRadiusRatio(1);
    expect(traceRadius * 2).toBeGreaterThan(1);
  });

  it('keeps an established cell visibly responsive to the amount shrimp remove', () => {
    const visibleAlpha = (biomass: number): number =>
      algaeParticleAlpha(algaeVisualLevel(biomass));
    const mature = visibleAlpha(ALGAE_VISUAL_SATURATION_BIOMASS);
    const substantiallyGrazed = visibleAlpha(0.48);

    expect(substantiallyGrazed).toBeLessThan(mature * 0.96);
    expect(algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS)).toBe(0);
    expect(algaeVisualLevel(0.28)).toBeGreaterThan(0);
    expect(oedogoniumFilamentCount(
      'grazed-cell',
      algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS),
      ALGAE_RENDER_TRACE_BIOMASS,
    )).toBe(0);
  });

  it('makes a locally depleted film visibly lighter and smaller than a rich film', () => {
    const richBiomass = 0.02;
    const depletedBiomass = 0.002;
    const visibleAlpha = (biomass: number): number =>
      algaeParticleAlpha(algaeVisualRatio(biomass) * ALGAE_VISUAL_LEVEL_COUNT);
    const visibleRadius = (biomass: number): number =>
      algaeParticleRadiusRatio(
        algaeVisualRatio(biomass) * ALGAE_VISUAL_LEVEL_COUNT,
      );

    expect(visibleAlpha(richBiomass) - visibleAlpha(depletedBiomass))
      .toBeGreaterThanOrEqual(0.055);
    expect(visibleAlpha(depletedBiomass) / visibleAlpha(richBiomass))
      .toBeLessThan(0.92);
    expect(visibleRadius(richBiomass) - visibleRadius(depletedBiomass))
      .toBeGreaterThanOrEqual(0.06);
  });

  it('maps only real biomass to a monotonic, perceptually amplified density', () => {
    const trace = algaeVisualLevel(0.004);
    const young = algaeVisualLevel(0.04);
    const established = algaeVisualLevel(0.28);
    const mature = algaeVisualLevel(ALGAE_VISUAL_SATURATION_BIOMASS);

    expect(trace).toBeGreaterThan(0);
    expect(young).toBeGreaterThan(trace);
    expect(established).toBeGreaterThan(young);
    expect(mature).toBe(ALGAE_VISUAL_LEVEL_COUNT);
    expect(algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS * 2)).toBeGreaterThan(0);
    expect(SURFACE_FILM_DISPERSAL_TIME_SCALE).toBeGreaterThan(1);
  });

  it('keeps a starter film readable while making a dense film much darker', () => {
    const starterOpacity = algaeParticleAlpha(algaeVisualLevel(0.12));
    const matureOpacity = algaeParticleAlpha(
      algaeVisualLevel(ALGAE_VISUAL_SATURATION_BIOMASS),
    );

    expect(starterOpacity).toBeGreaterThanOrEqual(0.67);
    expect(matureOpacity).toBe(1);
    expect(matureOpacity - starterOpacity).toBeGreaterThanOrEqual(0.13);
  });

  it('makes normal-play spread visible only after real biomass reaches neighboring cells', () => {
    const world = new SimulationWorld('mission-1');
    const stonePoint = { x: 600, y: 390 };
    world.handle({
      type: 'pick-structure',
      definitionId: 'flat-stone',
      point: stonePoint,
    });
    world.handle({ type: 'drop-held', point: stonePoint });
    for (let frame = 0; frame < 720; frame += 1) world.tick(1 / 60);
    const inoculationCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'structure-face')
      .sort((left, right) =>
        Math.abs(left.light - 68) - Math.abs(right.light - 68))[0];
    expect(inoculationCell).toBeDefined();
    world.handle({
      type: 'pick-seed',
      speciesId: 'oedogonium',
      point: inoculationCell,
    });
    world.handle({ type: 'drop-held', point: inoculationCell });

    const initial = world.snapshot();
    const initialTotal = initial.totalBiomass.oedogonium;
    const initialVisibleCells = initial.cells.filter(
      (cell) => cell.biomass.oedogonium > ALGAE_VISIBLE_BIOMASS,
    ).length;
    world.handle({ type: 'start' });
    while (world.snapshot().elapsedSeconds < 12) world.tick(0.1);
    const spread = world.snapshot();
    const actualVisibleCells = spread.cells.filter(
      (cell) => cell.biomass.oedogonium > ALGAE_VISIBLE_BIOMASS,
    );
    const renderedTraceCells = spread.cells.filter(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    );

    expect(spread.totalBiomass.oedogonium).toBeGreaterThan(initialTotal);
    expect(actualVisibleCells.length).toBeGreaterThanOrEqual(initialVisibleCells);
    expect(renderedTraceCells.length).toBeGreaterThan(initialVisibleCells);
    expect(renderedTraceCells.length).toBeGreaterThanOrEqual(actualVisibleCells.length);
    const densestCell = Math.max(...actualVisibleCells.map(
      (cell) => cell.biomass.oedogonium,
    ));
    expect(densestCell).toBeGreaterThan(0.08);
    expect(densestCell).toBeLessThanOrEqual(0.15);
    expect(actualVisibleCells.every(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    )).toBe(true);
  });

  it('grows the same local surface-film front in mission 5 without a trace-cell cascade', () => {
    const world = new SimulationWorld('mission-5');
    const inoculationCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) =>
        Math.abs(left.light - 68) - Math.abs(right.light - 68))[0];
    expect(inoculationCell).toBeDefined();
    if (!inoculationCell) return;
    world.handle({
      type: 'pick-seed',
      speciesId: 'oedogonium',
      point: inoculationCell,
    });
    world.handle({ type: 'drop-held', point: inoculationCell });
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    let snapshot = world.snapshot();
    while (snapshot.elapsedSeconds < 120) {
      world.tick(0.1);
      snapshot = world.snapshot();
    }

    const occupied = snapshot.cells.filter(
      (cell) => cell.biomass.oedogonium > 0.001,
    );
    const rendered = snapshot.cells.filter(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    );
    const earlyTotal = snapshot.totalBiomass.oedogonium;
    const earlySpan = Math.max(...occupied.map((cell) => cell.x)) -
      Math.min(...occupied.map((cell) => cell.x));
    const earlyRenderedSpan = Math.max(...rendered.map((cell) => cell.x)) -
      Math.min(...rendered.map((cell) => cell.x));

    // The opening front should be clearly wider than the inoculation cell,
    // not merely one trace in one neighbour.
    expect(occupied.length).toBeGreaterThanOrEqual(10);
    expect(occupied.length).toBeLessThanOrEqual(55);
    expect(rendered.length).toBeGreaterThanOrEqual(occupied.length);
    expect(rendered.length).toBeLessThanOrEqual(140);
    expect(earlySpan).toBeGreaterThanOrEqual(60);
    expect(earlyRenderedSpan).toBeGreaterThanOrEqual(100);
    expect(Math.max(...occupied.map((cell) => cell.biomass.oedogonium)))
      .toBeGreaterThan(0.03);

    while (snapshot.elapsedSeconds < 600) {
      world.tick(0.1);
      snapshot = world.snapshot();
    }
    const occupied600 = snapshot.cells.filter(
      (cell) => cell.biomass.oedogonium > 0.001,
    );
    const rendered600 = snapshot.cells.filter(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    );
    const laterSpan = Math.max(...occupied600.map((cell) => cell.x)) -
      Math.min(...occupied600.map((cell) => cell.x));

    // A ten-minute colony keeps advancing without retaining one dense,
    // overlapping source clump or recreating the old 400+-cell trace cascade.
    expect(occupied600.length).toBeGreaterThan(occupied.length);
    expect(occupied600.length).toBeLessThanOrEqual(140);
    expect(rendered600.length).toBeGreaterThanOrEqual(occupied600.length);
    expect(rendered600.length).toBeLessThanOrEqual(260);
    expect(laterSpan).toBeGreaterThan(earlySpan);
    expect(laterSpan).toBeGreaterThanOrEqual(250);
    expect(snapshot.totalBiomass.oedogonium).toBeGreaterThan(earlyTotal);
    const densestLaterCell = Math.max(
      ...occupied600.map((cell) => cell.biomass.oedogonium),
    );
    expect(densestLaterCell).toBeGreaterThan(0.003);
    expect(densestLaterCell).toBeLessThan(0.012);
  });

  it('shows shrimp food flecks only when authoritative consumed biomass rises', () => {
    expect(shouldTriggerShrimpGrazingPulse(null, 3, 0.1, 0.11)).toBe(false);
    expect(shouldTriggerShrimpGrazingPulse(3, 3, 0.1, 0.11)).toBe(false);
    expect(shouldTriggerShrimpGrazingPulse(3, 4, 0.1, 0.1)).toBe(false);
    expect(shouldTriggerShrimpGrazingPulse(3, 4, 0.1, 0.1001)).toBe(true);
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
    expect(algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS / 2)).toBe(0);
    expect(algaeVisualLevel(0.0005)).toBeGreaterThan(0);
  });

  it('does not refresh a mature cell for ecology fields that cannot change its picture', () => {
    const baseline = matureCell();
    const tinyBiomassChange = matureCell({
      light: 11,
      targetEligible: false,
      biomass: {
        oedogonium: baseline.biomass.oedogonium + 0.00001,
        nitzschia: baseline.biomass.nitzschia + 0.00001,
        vallisneria: 0,
      },
    });

    expect(algaeCellVisualKey(tinyBiomassChange)).toBe(
      algaeCellVisualKey(baseline),
    );
  });

  it('refreshes for growth, grazing, and geometry across the full density range', () => {
    const baseline = matureCell();
    const visiblyDenser = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.9 },
    });
    const visiblyGrazed = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.48 },
    });
    const moved = matureCell({ x: baseline.x + 0.01 });

    expect(algaeVisualLevel(visiblyDenser.biomass.oedogonium)).toBeGreaterThan(
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

  it('refreshes a grazed cell before the old coarse visual level changes', () => {
    const baseline = matureCell({
      biomass: { oedogonium: 0.288, nitzschia: 0.288, vallisneria: 0 },
    });
    const grazed = matureCell({
      biomass: { oedogonium: 0.286, nitzschia: 0.286, vallisneria: 0 },
    });

    expect(algaeVisualLevel(grazed.biomass.nitzschia)).toBe(
      algaeVisualLevel(baseline.biomass.nitzschia),
    );
    expect(algaeParticleAlpha(
      algaeVisualRatio(grazed.biomass.nitzschia) * ALGAE_VISUAL_LEVEL_COUNT,
    )).toBeLessThan(algaeParticleAlpha(
      algaeVisualRatio(baseline.biomass.nitzschia) * ALGAE_VISUAL_LEVEL_COUNT,
    ));
    expect(algaeParticleRadiusRatio(
      algaeVisualRatio(grazed.biomass.nitzschia) * ALGAE_VISUAL_LEVEL_COUNT,
    )).toBeLessThan(algaeParticleRadiusRatio(
      algaeVisualRatio(baseline.biomass.nitzschia) * ALGAE_VISUAL_LEVEL_COUNT,
    ));
    expect(algaeCellVisualKey(grazed)).not.toBe(algaeCellVisualKey(baseline));
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(grazed.biomass.nitzschia),
      grazed.biomass.nitzschia,
    )).toBeLessThanOrEqual(nitzschiaSpeckCount(
      algaeVisualLevel(baseline.biomass.nitzschia),
      baseline.biomass.nitzschia,
    ));
  });
});
