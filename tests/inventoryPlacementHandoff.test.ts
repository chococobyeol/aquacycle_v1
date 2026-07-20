import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  isInventoryHandoffCaughtUp,
  isSecondaryPointerGesture,
} from '../src/renderer/tank/AquariumCanvas';
import type { HoldingSnapshot } from '../src/simulation/types';

const heldStone = (x: number, y: number): HoldingSnapshot => ({
  kind: 'structure',
  source: 'inventory',
  valid: true,
  x,
  y,
  structureId: 'structure-1',
  structureDefinitionId: 'flat-stone',
});

describe('inventory cursor handoff', () => {
  it('keeps the cursor ghost through the first worker frame', () => {
    expect(isInventoryHandoffCaughtUp(heldStone(90, 110), { x: 90, y: 110 }, 16)).toBe(false);
  });

  it('does not reveal a held object at a stale tank-entry coordinate', () => {
    expect(isInventoryHandoffCaughtUp(heldStone(90, 110), { x: 520, y: 330 }, 80)).toBe(false);
  });

  it('hands rendering over once the worker-held object reaches the live pointer', () => {
    expect(isInventoryHandoffCaughtUp(heldStone(517, 333), { x: 520, y: 330 }, 80)).toBe(true);
  });

  it('hands rendering over after two post-pick motion samples when placement is constrained', () => {
    expect(isInventoryHandoffCaughtUp(heldStone(44, 110), { x: 5, y: 110 }, 80, true)).toBe(true);
  });

  it('does not use the settled-motion fallback before the worker has sampled twice', () => {
    expect(isInventoryHandoffCaughtUp(heldStone(44, 110), { x: 5, y: 110 }, 80, false)).toBe(false);
  });
});

describe('secondary placement gesture', () => {
  it('treats a right click as cancel', () => {
    expect(isSecondaryPointerGesture(2, false)).toBe(true);
  });

  it('treats macOS Control-click as cancel', () => {
    expect(isSecondaryPointerGesture(0, true)).toBe(true);
  });

  it('keeps an ordinary primary click as placement', () => {
    expect(isSecondaryPointerGesture(0, false)).toBe(false);
  });
});
