import type { SimulationSaveData } from '../../simulation/types';

const WARM_RESTART_KEY = 'aquacycle.pending-memory-restart';
const WARM_RESTART_UI_KEY = 'aquacycle.pending-memory-restart-ui';
export const PREPARE_MEMORY_RESTART_EVENT =
  'aquacycle:prepare-memory-restart';

/**
 * A renderer restart is the only reliable way for Chromium to return worker
 * heap regions to the OS. Keep one short-lived handoff in origin storage so
 * the fresh renderer can reopen the running tank, then delete it immediately.
 * This is not a user save slot and never accumulates multiple aquariums.
 */
export const stageWarmRestart = (data: SimulationSaveData): boolean => {
  try {
    window.localStorage.setItem(WARM_RESTART_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
};

export const takeWarmRestart = (): SimulationSaveData | null => {
  const serialized = window.localStorage.getItem(WARM_RESTART_KEY);
  if (!serialized) return null;
  window.localStorage.removeItem(WARM_RESTART_KEY);
  try {
    const data = JSON.parse(serialized) as Partial<SimulationSaveData>;
    return data.version === 1 && typeof data.scenarioId === 'string'
      ? data as SimulationSaveData
      : null;
  } catch {
    return null;
  }
};

export const stageWarmRestartUiState = (
  state: Record<string, unknown>,
): boolean => {
  try {
    window.localStorage.setItem(WARM_RESTART_UI_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

export const takeWarmRestartUiState = <
  State extends Record<string, unknown>,
>(): State | null => {
  const serialized = window.localStorage.getItem(WARM_RESTART_UI_KEY);
  if (!serialized) return null;
  window.localStorage.removeItem(WARM_RESTART_UI_KEY);
  try {
    const state = JSON.parse(serialized) as unknown;
    return state && typeof state === 'object'
      ? state as State
      : null;
  } catch {
    return null;
  }
};
