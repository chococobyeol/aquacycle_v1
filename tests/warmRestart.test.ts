import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  stageWarmRestart,
  stageWarmRestartUiState,
  takeWarmRestart,
  takeWarmRestartUiState,
} from '../src/renderer/storage/warmRestart';

describe('memory-pressure warm restart handoff', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it('restores one running tank once without creating a persistent save list', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    for (let index = 0; index < 12; index += 1) world.tick(0.1);
    const data = world.exportSaveData();

    expect(stageWarmRestart(data)).toBe(true);
    expect(takeWarmRestart()).toEqual(data);
    expect(takeWarmRestart()).toBeNull();
  });

  it('restores open UI state once beside the tank handoff', () => {
    const uiState = {
      openHudPanels: {
        menu: false,
        inventory: false,
        quest: false,
        observation: true,
      },
      waterQualityMapVisible: true,
      observationView: 'overview',
    };

    expect(stageWarmRestartUiState(uiState)).toBe(true);
    expect(takeWarmRestartUiState()).toEqual(uiState);
    expect(takeWarmRestartUiState()).toBeNull();
  });
});
