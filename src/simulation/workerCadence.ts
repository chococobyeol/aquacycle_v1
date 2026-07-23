export const WORKER_SIMULATION_QUANTUM_SECONDS = 1 / 120;
export const MAX_WORKER_PENDING_REAL_SECONDS = 0.1;

export const addPendingWorkerTime = (
  pendingSeconds: number,
  elapsedSeconds: number,
): number => Math.min(
  MAX_WORKER_PENDING_REAL_SECONDS,
  Math.max(0, pendingSeconds) + Math.min(
    MAX_WORKER_PENDING_REAL_SECONDS,
    Math.max(0, elapsedSeconds),
  ),
);

export const takeWorkerSimulationQuantum = (
  pendingSeconds: number,
): { deltaSeconds: number; remainingSeconds: number } | null => {
  if (pendingSeconds + 1e-10 < WORKER_SIMULATION_QUANTUM_SECONDS) return null;
  const remainingSeconds = pendingSeconds - WORKER_SIMULATION_QUANTUM_SECONDS;
  return {
    deltaSeconds: WORKER_SIMULATION_QUANTUM_SECONDS,
    remainingSeconds: Math.abs(remainingSeconds) < 1e-10 ? 0 : remainingSeconds,
  };
};
