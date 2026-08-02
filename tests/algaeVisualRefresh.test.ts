import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL,
  ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL,
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
  algaeVisualLevel,
  oedogoniumFilamentCount,
  shouldTriggerShrimpGrazingPulse,
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
  algaeContinuousDensity,
  algaeDensityOpacity,
  writeAlgaeDensityPixels,
} from '../src/renderer/tank/algaeDensityPresentation';
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
    expect(averageSpeckDiameterAtDefaultZoom).toBeGreaterThanOrEqual(1.3);
    expect(NITZSCHIA_VISUAL_STYLE.structureAlpha).toBeLessThan(
      NITZSCHIA_VISUAL_STYLE.substrateAlpha,
    );
    expect(NITZSCHIA_VISUAL_STYLE.structureAlpha).toBeGreaterThanOrEqual(0.74);
    expect(OEDOGONIUM_DENSITY_ALPHA).toBeGreaterThanOrEqual(0.98);
  });

  it('draws a new real colony as a small readable wisp rather than a full-cell stamp', () => {
    const minimumVisibleLevel = 1;

    expect(algaeParticleRadiusRatio(minimumVisibleLevel)).toBeLessThan(0.4);
    expect(algaeParticleAlpha(minimumVisibleLevel)).toBeGreaterThanOrEqual(0.35);
    expect(algaeParticleAlpha(ALGAE_VISUAL_LEVEL_COUNT)).toBe(1);
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
    expect(filaments).toBeGreaterThanOrEqual(3);
    expect(filaments).toBeLessThanOrEqual(5);
    expect(algaeContinuousDensity(biomass)).toBeGreaterThan(0.44);

    const width = 32;
    const height = 20;
    const pixels = new Uint8Array(width * height * 4);
    writeAlgaeDensityPixels({
      pixels,
      density: new Float32Array(width * height),
      scratch: new Float32Array(width * height),
      width,
      height,
      worldWidth: 160,
      worldHeight: 100,
    }, [
      { x: 80, y: 50, cellSize: 30, biomass },
    ], { red: 84, green: 132, blue: 73 });

    const alphaAt = (x: number, y: number): number =>
      pixels[(y * width + x) * 4 + 3];
    expect(alphaAt(width / 2, height / 2)).toBeGreaterThanOrEqual(75);
    expect(alphaAt(width / 2 + 2, height / 2)).toBeGreaterThan(0);
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
    )).toBeGreaterThanOrEqual(2);
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(missionDose),
      missionDose,
    )).toBeLessThanOrEqual(3);
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
    expect(nitzschiaSpeckCount(1)).toBe(0);
    expect(nitzschiaSpeckCount(ALGAE_VISUAL_LEVEL_COUNT))
      .toBe(ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL);
    expect(nitzschiaSpeckCount(0))
      .toBe(0);
  });

  it('uses the soft film alone for a dispersal trace and caps crisp grains', () => {
    const traceBiomass = ALGAE_VISIBLE_BIOMASS * 0.5;
    const starterBiomass = SURFACE_ALGAE_INOCULUM_BIOMASS;

    expect(nitzschiaSpeckCount(
      algaeVisualLevel(traceBiomass),
      traceBiomass,
    )).toBe(0);
    expect(nitzschiaSpeckCount(
      algaeVisualLevel(starterBiomass),
      starterBiomass,
    )).toBe(3);
    expect(nitzschiaSpeckCount(
      ALGAE_VISUAL_LEVEL_COUNT,
      ALGAE_VISUAL_SATURATION_BIOMASS,
    )).toBe(8);
  });

  it('carries sparse filaments across a real low-biomass Oedogonium front', () => {
    const frontCounts = Array.from({ length: 24 }, (_, index) =>
      oedogoniumFilamentCount(`front-cell-${index}`, 1));
    const visibleStrands = frontCounts.reduce((sum, count) => sum + count, 0);

    expect(visibleStrands).toBeGreaterThanOrEqual(10);
    expect(visibleStrands).toBeLessThan(24);
    expect(frontCounts.every((count) => count === 0 || count === 1)).toBe(true);
    expect(oedogoniumFilamentCount('empty', 0)).toBe(0);
    expect(oedogoniumFilamentCount(
      'mature',
      ALGAE_VISUAL_LEVEL_COUNT,
    )).toBe(ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL);
  });

  it('joins adjacent occupied samples into one continuous density field', () => {
    const width = 48;
    const height = 24;
    const pixels = new Uint8Array(width * height * 4);
    writeAlgaeDensityPixels({
      pixels,
      density: new Float32Array(width * height),
      scratch: new Float32Array(width * height),
      width,
      height,
      worldWidth: 240,
      worldHeight: 120,
    }, [
      { x: 90, y: 60, cellSize: 30, biomass: 0.04 },
      { x: 120, y: 60, cellSize: 30, biomass: 0.04 },
    ], { red: 84, green: 132, blue: 73 });

    const alphaAt = (x: number, y: number): number =>
      pixels[(y * width + x) * 4 + 3];
    expect(alphaAt(18, 12)).toBeGreaterThan(0);
    expect(alphaAt(24, 12)).toBeGreaterThan(0);
    expect(alphaAt(21, 12)).toBeGreaterThanOrEqual(
      Math.min(alphaAt(18, 12), alphaAt(24, 12)) * 0.55,
    );
  });

  it('keeps an established cell visibly responsive to the amount shrimp remove', () => {
    const centerAlpha = (biomass: number): number => {
      const width = 32;
      const height = 20;
      const pixels = new Uint8Array(width * height * 4);
      writeAlgaeDensityPixels({
        pixels,
        density: new Float32Array(width * height),
        scratch: new Float32Array(width * height),
        width,
        height,
        worldWidth: 160,
        worldHeight: 100,
      }, [
        { x: 80, y: 50, cellSize: 30, biomass },
      ], { red: 84, green: 132, blue: 73 });
      return pixels[((height / 2) * width + width / 2) * 4 + 3];
    };

    const mature = centerAlpha(ALGAE_VISUAL_SATURATION_BIOMASS);
    const substantiallyGrazed = centerAlpha(0.48);
    const beforeOneBite = centerAlpha(0.288);
    const afterOneBite = centerAlpha(0.282);

    expect(substantiallyGrazed).toBeLessThan(mature * 0.82);
    expect(afterOneBite).toBeLessThan(beforeOneBite);
  });

  it('removes only the grazed cell footprint below the real render threshold', () => {
    const width = 64;
    const height = 24;
    const render = (leftBiomass: number): Uint8Array => {
      const pixels = new Uint8Array(width * height * 4);
      writeAlgaeDensityPixels({
        pixels,
        density: new Float32Array(width * height),
        scratch: new Float32Array(width * height),
        width,
        height,
        worldWidth: 160,
        worldHeight: 60,
      }, [
        { x: 40, y: 30, cellSize: 30, biomass: leftBiomass },
        { x: 120, y: 30, cellSize: 30, biomass: 0.28 },
      ], { red: 84, green: 132, blue: 73 });
      return pixels;
    };
    const alphaAt = (pixels: Uint8Array, x: number, y: number): number =>
      pixels[(y * width + x) * 4 + 3];
    const before = render(0.28);
    const after = render(ALGAE_RENDER_TRACE_BIOMASS);
    const leftX = 16;
    const rightX = 48;
    const centerY = 12;

    expect(alphaAt(before, leftX, centerY)).toBeGreaterThan(0);
    expect(alphaAt(after, leftX, centerY)).toBe(0);
    expect(alphaAt(after, rightX, centerY)).toBe(
      alphaAt(before, rightX, centerY),
    );
    expect(oedogoniumFilamentCount(
      'grazed-cell',
      algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS),
      ALGAE_RENDER_TRACE_BIOMASS,
    )).toBe(0);
  });

  it('visibly thins a grazed cell even where neighboring colony clouds meet', () => {
    const width = 64;
    const height = 24;
    const render = (leftBiomass: number): Uint8Array => {
      const pixels = new Uint8Array(width * height * 4);
      writeAlgaeDensityPixels({
        pixels,
        density: new Float32Array(width * height),
        scratch: new Float32Array(width * height),
        width,
        height,
        worldWidth: 160,
        worldHeight: 60,
      }, [
        { x: 65, y: 30, cellSize: 30, biomass: leftBiomass },
        { x: 95, y: 30, cellSize: 30, biomass: 0.28 },
      ], { red: 84, green: 132, blue: 73 });
      return pixels;
    };
    const alphaAt = (pixels: Uint8Array, x: number, y: number): number =>
      pixels[(y * width + x) * 4 + 3];
    const before = render(0.28);
    const after = render(ALGAE_RENDER_TRACE_BIOMASS);
    const leftX = 26;
    const rightX = 38;
    const centerY = 12;

    expect(alphaAt(after, leftX, centerY)).toBeLessThan(
      alphaAt(before, leftX, centerY) * 0.55,
    );
    expect(alphaAt(after, rightX, centerY)).toBe(
      alphaAt(before, rightX, centerY),
    );
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
    expect(algaeContinuousDensity(0)).toBe(0);
    expect(algaeContinuousDensity(0.004)).toBeGreaterThan(0);
    expect(algaeVisualLevel(ALGAE_RENDER_TRACE_BIOMASS * 2)).toBeGreaterThan(0);
    expect(SURFACE_FILM_DISPERSAL_TIME_SCALE).toBeGreaterThan(1);
  });

  it('keeps a starter film readable while making a dense film much darker', () => {
    const starterOpacity = algaeDensityOpacity(algaeContinuousDensity(0.12));
    const matureOpacity = algaeDensityOpacity(
      algaeContinuousDensity(ALGAE_VISUAL_SATURATION_BIOMASS),
    );

    expect(starterOpacity).toBeGreaterThanOrEqual(0.42);
    expect(matureOpacity).toBeGreaterThanOrEqual(0.95);
    expect(matureOpacity - starterOpacity).toBeGreaterThanOrEqual(0.53);
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
    while (world.snapshot().elapsedSeconds < 30) world.tick(0.1);
    const spread = world.snapshot();
    const actualVisibleCells = spread.cells.filter(
      (cell) => cell.biomass.oedogonium > ALGAE_VISIBLE_BIOMASS,
    );
    const renderedTraceCells = spread.cells.filter(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    );

    expect(spread.totalBiomass.oedogonium).toBeGreaterThan(initialTotal);
    expect(actualVisibleCells.length).toBeGreaterThan(initialVisibleCells);
    expect(renderedTraceCells.length).toBeGreaterThanOrEqual(
      actualVisibleCells.length + 8,
    );
    const densestCell = Math.max(...actualVisibleCells.map(
      (cell) => cell.biomass.oedogonium,
    ));
    expect(densestCell).toBeGreaterThan(0.08);
    expect(densestCell).toBeLessThanOrEqual(0.15);
    expect(actualVisibleCells.every(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    )).toBe(true);
    expect(spread.cells.some(
      (cell) => cell.biomass.oedogonium <= ALGAE_VISIBLE_BIOMASS &&
        algaeVisualLevel(cell.biomass.oedogonium) > 0,
    )).toBe(true);
  });

  it('spreads the same surface film across mission 5 instead of using a mission-specific clump rule', () => {
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
    while (snapshot.elapsedSeconds < 600) {
      world.tick(0.1);
      snapshot = world.snapshot();
    }

    const occupied = snapshot.cells.filter(
      (cell) => cell.biomass.oedogonium > 0.001,
    );
    const rendered = snapshot.cells.filter(
      (cell) => algaeVisualLevel(cell.biomass.oedogonium) > 0,
    );
    expect(occupied.length).toBeGreaterThanOrEqual(45);
    expect(rendered.length).toBeGreaterThanOrEqual(60);
    expect(
      Math.max(...occupied.map((cell) => cell.x)) -
        Math.min(...occupied.map((cell) => cell.x)),
    ).toBeGreaterThanOrEqual(140);
    expect(Math.max(...occupied.map((cell) => cell.biomass.oedogonium)))
      .toBeLessThan(0.03);
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

  it('refreshes for visible grazing or geometry, but not saturated overdraw', () => {
    const baseline = matureCell();
    const visiblyDenser = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.9 },
    });
    const visiblyGrazed = matureCell({
      biomass: { ...baseline.biomass, oedogonium: 0.48 },
    });
    const moved = matureCell({ x: baseline.x + 0.01 });

    expect(algaeVisualLevel(visiblyDenser.biomass.oedogonium)).toBe(
      algaeVisualLevel(baseline.biomass.oedogonium),
    );
    expect(algaeVisualLevel(visiblyGrazed.biomass.oedogonium)).toBeLessThan(
      algaeVisualLevel(baseline.biomass.oedogonium),
    );
    expect(algaeCellVisualKey(visiblyDenser)).toBe(
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
      biomass: { oedogonium: 0.282, nitzschia: 0.282, vallisneria: 0 },
    });

    expect(algaeVisualLevel(grazed.biomass.nitzschia)).toBe(
      algaeVisualLevel(baseline.biomass.nitzschia),
    );
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
