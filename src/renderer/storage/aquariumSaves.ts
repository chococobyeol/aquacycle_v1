import type { ScenarioId, SimulationSaveData } from '../../simulation/types';

export const AQUARIUM_SAVES_KEY = 'aquacycle.frozen-aquariums.v1';
export const MAX_FROZEN_AQUARIUMS = 12;

export interface FrozenAquariumRecord {
  id: string;
  name: string;
  scenarioId: ScenarioId;
  createdAt: string;
  elapsedSeconds: number;
  data: SimulationSaveData;
}

const isFrozenAquariumRecord = (value: unknown): value is FrozenAquariumRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FrozenAquariumRecord>;
  return typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.scenarioId === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.elapsedSeconds === 'number' &&
    record.data?.version === 1 &&
    record.data.scenarioId === record.scenarioId;
};

export const readFrozenAquariums = (): FrozenAquariumRecord[] => {
  const stored = window.localStorage.getItem(AQUARIUM_SAVES_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFrozenAquariumRecord)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
};

const writeFrozenAquariums = (records: FrozenAquariumRecord[]): void => {
  window.localStorage.setItem(
    AQUARIUM_SAVES_KEY,
    JSON.stringify(records.slice(0, MAX_FROZEN_AQUARIUMS)),
  );
};

export const freezeAquarium = (
  name: string,
  data: SimulationSaveData,
): FrozenAquariumRecord[] => {
  const now = new Date().toISOString();
  const record: FrozenAquariumRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `frozen-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim() || '이름 없는 냉동 수조',
    scenarioId: data.scenarioId,
    createdAt: now,
    elapsedSeconds: data.elapsedSeconds,
    data,
  };
  const next = [record, ...readFrozenAquariums()].slice(0, MAX_FROZEN_AQUARIUMS);
  writeFrozenAquariums(next);
  return next;
};

export const discardFrozenAquarium = (id: string): FrozenAquariumRecord[] => {
  const next = readFrozenAquariums().filter((record) => record.id !== id);
  writeFrozenAquariums(next);
  return next;
};
