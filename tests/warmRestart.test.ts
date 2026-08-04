import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  stageWarmRestart,
  stageWarmRestartUiState,
  takeWarmRestart,
  takeWarmRestartUiState,
} from '../src/renderer/storage/warmRestart';
import { freshSimulationEntry } from '../src/renderer/ui/App';

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

  it('does not attach an old recovery save when the same mission is opened again', () => {
    const data = new SimulationWorld('mission-5').exportSaveData();
    const recoveredEntry = {
      scenarioId: data.scenarioId,
      initialSaveData: data,
    };
    const reopenedEntry = freshSimulationEntry(data.scenarioId);

    expect(recoveredEntry.initialSaveData).toBe(data);
    expect(reopenedEntry).toEqual({ scenarioId: 'mission-5' });
    expect(reopenedEntry.initialSaveData).toBeUndefined();
    expect(reopenedEntry.initialUiState).toBeUndefined();
  });
});
