import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

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
import { heldPlacementToolbarCopy } from '../src/renderer/ui/SimulationScreen';
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

describe('held item toolbar copy', () => {
  it('presents every holding kind without routing plankton through surface species', () => {
    const base = {
      source: 'inventory' as const,
      valid: true,
      x: 400,
      y: 260,
    };
    const holdings: HoldingSnapshot[] = [
      { ...base, kind: 'structure', structureDefinitionId: 'flat-stone' },
      { ...base, kind: 'seed', speciesId: 'oedogonium' },
      { ...base, kind: 'animal', animalSpeciesId: 'cherry-shrimp' },
      { ...base, kind: 'biofilm', microbeGuildId: 'decomposer' },
      { ...base, kind: 'plankton', planktonKind: 'phytoplankton' },
      { ...base, kind: 'plankton', planktonKind: 'daphnia' },
    ];

    expect(holdings.map((holding) => heldPlacementToolbarCopy(holding).label)).toEqual([
      '넓적한 사암',
      '붓뚜껑말',
      '체리새우',
      '분해균 필름',
      '녹색 식물플랑크톤',
      '큰물벼룩',
    ]);
    expect(heldPlacementToolbarCopy(holdings.at(-1)!).instruction)
      .toBe('수면 아래 원하는 위치를 클릭해 방류');
  });

  it('uses safe fallback copy for a partially delivered worker snapshot', () => {
    expect(heldPlacementToolbarCopy({
      kind: 'plankton',
      source: 'inventory',
      valid: false,
      x: 0,
      y: 0,
    })).toEqual({
      label: '부유 생물',
      instruction: '수면 아래 원하는 위치를 클릭해 접종',
    });
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

describe('inventory preview rendering contract', () => {
  const screenSource = readFileSync(
    new URL('../src/renderer/ui/SimulationScreen.tsx', import.meta.url),
    'utf8',
  );
  const canvasSource = readFileSync(
    new URL('../src/renderer/tank/AquariumCanvas.tsx', import.meta.url),
    'utf8',
  );
  const canvasStyles = readFileSync(
    new URL('../src/renderer/styles/v2.css', import.meta.url),
    'utf8',
  );
  const rendererEntrySource = readFileSync(
    new URL('../src/renderer/main.tsx', import.meta.url),
    'utf8',
  );

  it('does not reuse the inner biofilm art class on the fixed cursor wrapper', () => {
    expect(screenSource).toContain('className="inventory-cursor-ghost"');
    expect(screenSource).not.toContain('inventory-cursor-ghost ghost-${pendingInventory.kind}');
  });

  it('keys each handoff and reveals the Pixi preview before removing the DOM ghost', () => {
    expect(screenSource).toContain('pendingInventoryKey={pendingInventory ? String(pendingInventory.requestId) : null}');
    const handoffBlock = canvasSource.slice(
      canvasSource.indexOf('const tryCompletePendingInventoryHandoff'),
      canvasSource.indexOf('const tryCompletePendingDrop'),
    );
    expect(handoffBlock).toContain('revealPendingInventoryPreview(holding)');
    expect(handoffBlock.indexOf('revealPendingInventoryPreview(holding)'))
      .toBeLessThan(handoffBlock.indexOf('finishPendingInventoryAfterPaint();'));
  });

  it('keeps a camera-tracked DOM marker after the inventory ghost hands off', () => {
    expect(screenSource).toContain('tank-biological-placement-marker');
    expect(screenSource).toContain('cameraTransform.offsetX + snapshot.holding.x');
  });

  it('authors the static aquarium frame once instead of clearing it during motion redraws', () => {
    expect(canvasSource.match(/drawTankFrame\(/g)).toHaveLength(1);
    expect(canvasSource).not.toContain('if (ownedLayers) drawTankFrame(ownedLayers.frame);');
  });

  it('does not double-mount the asynchronous Pixi application in development', () => {
    expect(rendererEntrySource).not.toContain('<StrictMode>');
  });

  it('keeps the DOM preview through a painted Pixi frame and a direct-drop acknowledgement', () => {
    expect(canvasSource).toContain('finishPendingInventoryAfterPaint');
    expect(canvasSource).toContain('pendingDropAckRevisionRef.current');
    expect(canvasSource.indexOf('pendingHandoffNotifiedRef.current = true;'))
      .toBeLessThan(canvasSource.indexOf('finishPendingInventoryAfterPaint();'));
  });

  it('keeps a visible system cursor while an object is held', () => {
    expect(canvasStyles).not.toMatch(/\.aquarium-canvas\.tool-(?:select|move)\.is-holding\s*\{\s*cursor:\s*none/);
  });

  it('rebuilds every Pixi layer after an intermittent WebGL context reset', () => {
    expect(canvasSource).toContain("preference: 'webgl'");
    expect(canvasSource).toContain("addEventListener('webglcontextlost'");
    expect(canvasSource).toContain("addEventListener('webglcontextrestored'");
    expect(canvasSource).toContain('app.stop();');
    expect(canvasSource).toContain("removeEventListener(\n          'webglcontextrestored',\n          pixiContextRestoredListener");
    expect(canvasSource).toContain('rendererRecoveryFrame = requestAnimationFrame');
    expect(canvasSource).toContain('releaseGlobalResourcesOnDestroy = true;');
    expect(canvasSource).toContain('setRendererRecoveryToken((token) => token + 1)');
    expect(canvasSource).toContain(
      '[onClearSelection, onToolComplete, rendererRecoveryToken, send]',
    );
    expect(canvasSource).not.toContain('app.renderer.render(app.stage)');
  });

  it('avoids the pooled Pixi alpha-mask filter that can freeze a partial frame', () => {
    expect(canvasSource).not.toContain('detailGraphics.setMask');
    expect(canvasSource).not.toContain('detailMaskSprite');
    expect(canvasSource).toContain('container.addChild(densityMarks, detailGraphics);');
    expect(canvasSource).not.toContain('densityTexture.source.update();');
    expect(canvasSource).toContain('autoStart: false');
    expect(canvasSource).toContain('app.ticker.remove(app.render, app);');
    expect(canvasSource).toContain('requestFullRendererRecovery();');
  });

  it('handles wheel rotation and zoom with a non-passive native listener', () => {
    expect(canvasSource).toContain("host.addEventListener('wheel', handleWheel, { passive: false });");
    expect(canvasSource).toContain("host.removeEventListener('wheel', handleWheel)");
    expect(canvasSource).not.toContain('onWheel={(event) => {\n        if (editable');
  });

  it('keeps move mode active after a canvas placement completes', () => {
    const completionBlock = screenSource.slice(
      screenSource.indexOf('const completeCanvasInteraction'),
      screenSource.indexOf('const toggleHudPanel'),
    );
    expect(completionBlock).toContain("setActiveTool(completedTool === 'move' ? 'move' : 'select');");
    expect(screenSource).toContain('onToolComplete={completeCanvasInteraction}');
    expect(canvasSource).toContain("onToolComplete('move');");
  });

  it('returns an in-progress placement before reopening the inventory', () => {
    const inventoryToggleBlock = screenSource.slice(
      screenSource.indexOf('const toggleInventoryPanel'),
      screenSource.indexOf('const closeHudPanel'),
    );
    expect(inventoryToggleBlock).toContain("send({ type: 'cancel-held' });");
    expect(inventoryToggleBlock).toContain('inventory: true');
    expect(screenSource).toContain('onClick={toggleInventoryPanel}');
  });

  it('labels Daphnia as individuals and phytoplankton as inoculation attempts', () => {
    expect(screenSource).toContain("kind === 'daphnia'");
    expect(screenSource).toContain('`${remaining}마리 남음`');
    expect(screenSource).toContain('planktonPlacementCountLabel(planktonKind, remaining)');
  });

  it('selects structures before showing separate move, rotate, and delete actions', () => {
    expect(screenSource).toContain('className="tank-structure-edit-orbit"');
    expect(screenSource).toContain("type: 'hold-structure'");
    expect(screenSource).toContain("type: 'rotate-structure'");
    expect(screenSource).toContain("type: 'retrieve-structure'");
    expect(screenSource).toContain('wheel-rotate-hint');
    expect(screenSource).toContain('motionSource.getFrames()');
    expect(screenSource).toContain('animationFrame = requestAnimationFrame(updatePosition);');
    expect(canvasStyles).toContain('.tank-structure-edit-orbit .structure-action-move { top: 0; left: 0; }');
    expect(canvasSource).toContain("event.key === 'Delete' || event.key === 'Backspace'");
    expect(canvasStyles).not.toContain('.tank-rotation-orbit');
  });
});
