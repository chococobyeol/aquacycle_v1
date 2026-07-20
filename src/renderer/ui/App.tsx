import { useCallback, useState } from 'react';
import type { ScenarioId } from '../../simulation/types';
import { MISSION_IDS, MissionMenu } from './MissionMenu';
import { SimulationScreen } from './SimulationScreen';

const LEGACY_PROGRESS_KEY = 'aquacycle.highest-unlocked-mission';
const COMPLETED_MISSIONS_KEY = 'aquacycle.completed-missions';
type MissionId = Exclude<ScenarioId, 'laboratory'>;

const readLegacyProgress = (): number => {
  const stored = window.localStorage.getItem(LEGACY_PROGRESS_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : 1;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MISSION_IDS.length, parsed)) : 1;
};

const readCompletedMissions = (): MissionId[] => {
  const stored = window.localStorage.getItem(COMPLETED_MISSIONS_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return MISSION_IDS.filter((missionId) => parsed.includes(missionId));
      }
    } catch {
      // Fall through to the legacy progress migration below.
    }
  }

  const highestUnlocked = readLegacyProgress();
  const migrated = MISSION_IDS.filter((_, index) => index + 1 < highestUnlocked);
  window.localStorage.setItem(COMPLETED_MISSIONS_KEY, JSON.stringify(migrated));
  return migrated;
};

export function App() {
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(null);
  const [completedMissions, setCompletedMissions] = useState<MissionId[]>(readCompletedMissions);

  const handleMissionComplete = useCallback((completedScenarioId: ScenarioId): void => {
    if (completedScenarioId === 'laboratory') return;
    setCompletedMissions((current) => {
      if (current.includes(completedScenarioId)) return current;
      const next = MISSION_IDS.filter((missionId) => current.includes(missionId) || missionId === completedScenarioId);
      window.localStorage.setItem(COMPLETED_MISSIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetMissionProgress = useCallback((): void => {
    window.localStorage.setItem(COMPLETED_MISSIONS_KEY, '[]');
    setCompletedMissions([]);
  }, []);

  if (scenarioId) {
    return (
      <SimulationScreen
        scenarioId={scenarioId}
        onBack={() => setScenarioId(null)}
        onMissionComplete={handleMissionComplete}
      />
    );
  }

  return (
    <MissionMenu
      completedMissions={completedMissions}
      onOpen={setScenarioId}
      onResetMissionProgress={resetMissionProgress}
    />
  );
}
