export const WORKER_SIMULATION_QUANTUM_SECONDS = 1 / 120;
export const MAX_WORKER_PENDING_REAL_SECONDS = 0.1;
export const WORKER_OVERLOAD_YIELD_MS = 4;
export const MAX_WORKER_IMMEDIATE_CATCH_UP_TASKS = 4;

const WORKER_SIMULATION_QUANTUM_MS =
  WORKER_SIMULATION_QUANTUM_SECONDS * 1000;

export interface WorkerContinuationPlan {
  delayMs: number;
  pendingSeconds: number;
  consecutiveImmediateCatchUps: number;
  rebaseClock: boolean;
  droppedDebt: boolean;
}

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

/**
 * Decide how the worker yields after executing one fixed simulation quantum.
 *
 * Fast work may use a small, bounded number of zero-delay continuations to
 * recover timer jitter. If one quantum already costs a whole quantum of wall
 * time, or that immediate catch-up budget is exhausted, the old wall-clock
 * debt is no longer achievable. Dropping it and rebasing the clock prevents
 * the worker's own computation time from being re-added forever.
 */
export const planWorkerContinuation = (
  pendingSeconds: number,
  workDurationMs: number,
  consecutiveImmediateCatchUps: number,
): WorkerContinuationPlan => {
  const boundedPendingSeconds = Math.max(0, pendingSeconds);
  const boundedWorkDurationMs = Math.max(0, workDurationMs);
  const stillBehind =
    boundedPendingSeconds + 1e-10 >= WORKER_SIMULATION_QUANTUM_SECONDS;
  const slowQuantum =
    boundedWorkDurationMs + 1e-7 >= WORKER_SIMULATION_QUANTUM_MS;
  const catchUpBudgetExhausted =
    stillBehind &&
    consecutiveImmediateCatchUps >= MAX_WORKER_IMMEDIATE_CATCH_UP_TASKS;

  if (slowQuantum || catchUpBudgetExhausted) {
    return {
      delayMs: WORKER_OVERLOAD_YIELD_MS,
      pendingSeconds: 0,
      consecutiveImmediateCatchUps: 0,
      rebaseClock: true,
      droppedDebt: true,
    };
  }

  if (stillBehind) {
    return {
      delayMs: 0,
      pendingSeconds: boundedPendingSeconds,
      consecutiveImmediateCatchUps: consecutiveImmediateCatchUps + 1,
      rebaseClock: false,
      droppedDebt: false,
    };
  }

  return {
    delayMs: Math.max(
      1,
      (WORKER_SIMULATION_QUANTUM_SECONDS - boundedPendingSeconds) * 1000,
    ),
    pendingSeconds: boundedPendingSeconds,
    consecutiveImmediateCatchUps: 0,
    rebaseClock: false,
    droppedDebt: false,
  };
};
