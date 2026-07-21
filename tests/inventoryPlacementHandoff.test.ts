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
    expect(canvasSource).toContain('[onToolComplete, rendererRecoveryToken, send]');
    expect(canvasSource).not.toContain('app.renderer.render(app.stage)');
  });

  it('avoids the pooled Pixi alpha-mask filter that can freeze a partial frame', () => {
    expect(canvasSource).not.toContain('detailGraphics.setMask');
    expect(canvasSource).not.toContain('detailMaskSprite');
    expect(canvasSource).toContain('container.addChild(densitySprite, detailGraphics);');
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
});
