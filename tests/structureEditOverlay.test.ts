import { describe, expect, it } from 'vitest';
import type { StructureSnapshot } from '../src/simulation/types';
import {
  structureEditOverlayLayout,
  structureEditOverlaySnapshot,
} from '../src/renderer/tank/structureEditOverlay';

const camera = {
  scale: 1.2,
  offsetX: 20,
  offsetY: 15,
  viewportWidth: 1_200,
  viewportHeight: 720,
};

const structure = (overrides: Partial<StructureSnapshot> = {}): StructureSnapshot => ({
  id: 'structure-1',
  definitionId: 'flat-stone',
  label: '넓적한 사암',
  assetPath: '/flat-stone.svg',
  x: 500,
  y: 400,
  angle: 0,
  width: 220,
  height: 80,
  isSleeping: false,
  locked: false,
  isHeld: false,
  placementValid: true,
  ...overrides,
});

describe('structure edit overlay layout', () => {
  it('keeps the move handle on the exact rendered structure centre', () => {
    const layout = structureEditOverlayLayout(structure(), camera);
    expect(layout.left).toBe(camera.offsetX + 500 * camera.scale);
    expect(layout.top).toBe(camera.offsetY + 400 * camera.scale);
  });

  it('tracks structure motion rather than waiting for a settled full snapshot', () => {
    const before = structureEditOverlayLayout(structure(), camera);
    const after = structureEditOverlayLayout(structure({ x: 570, y: 445 }), camera);
    expect(after.left - before.left).toBeCloseTo(70 * camera.scale, 6);
    expect(after.top - before.top).toBeCloseTo(45 * camera.scale, 6);
  });

  it('keeps full-snapshot dimensions while applying lightweight motion', () => {
    const base = structure();
    const rendered = structureEditOverlaySnapshot(base, {
      x: 570,
      y: 445,
      angle: Math.PI / 5,
    });
    expect(rendered.x).toBe(570);
    expect(rendered.y).toBe(445);
    expect(rendered.angle).toBe(Math.PI / 5);
    expect(rendered.width).toBe(base.width);
    expect(rendered.height).toBe(base.height);
    expect(rendered.definitionId).toBe(base.definitionId);
  });

  it('flips the delete action above a structure near the substrate', () => {
    const upper = structureEditOverlayLayout(structure({ y: 280 }), camera);
    const lower = structureEditOverlayLayout(structure({ y: 570 }), camera);
    expect(upper.deleteY).toBeGreaterThan(0);
    expect(lower.deleteY).toBeLessThan(0);
  });
});
