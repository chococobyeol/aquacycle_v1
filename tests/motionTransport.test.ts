import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandRebasesMotion,
  createSimulationMotionStore,
  shouldApplyInteractiveMotionOverlay,
} from '../src/renderer/hooks/useSimulation';
import {
  MOTION_SAMPLE_INTERVAL_MS,
  type SimulationCommand,
  type WorkerMessage,
  type WorkerMotionMessage,
} from '../src/simulation/types';
import { createSharedMotionChannel } from '../src/simulation/sharedMotionTelemetry';
import { createSharedTelemetryChannel } from '../src/simulation/sharedTelemetry';
import {
  addPendingWorkerTime,
  MAX_WORKER_IMMEDIATE_CATCH_UP_TASKS,
  planWorkerContinuation,
  takeWorkerSimulationQuantum,
  WORKER_OVERLOAD_YIELD_MS,
  WORKER_SIMULATION_QUANTUM_SECONDS,
} from '../src/simulation/workerCadence';

const motionMessage = (sequence: number): WorkerMotionMessage => ({
  type: 'motion',
  sequence,
  sampledAtMs: sequence * MOTION_SAMPLE_INTERVAL_MS,
  snapshotRevision: sequence,
  structures: [],
  animals: [],
  holding: null,
  probe: null,
});

describe('simulation motion store', () => {
  it('keeps only the latest interpolation pair and rejects delayed packets', () => {
    const store = createSimulationMotionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    for (let sequence = 1; sequence <= 20; sequence += 1) {
      expect(store.accept(motionMessage(sequence), 1_000 + sequence)).toBe(true);
    }
    expect(store.accept(motionMessage(19), 2_000)).toBe(false);
    expect(store.accept(motionMessage(20), 2_001)).toBe(false);

    const frames = store.getFrames();
    expect(frames.previous?.sequence).toBe(19);
    expect(frames.current?.sequence).toBe(20);
    expect(frames.current?.receivedAtMs).toBe(1_020);
    expect(listener).toHaveBeenCalledTimes(20);

    store.clear();
    expect(store.getFrames()).toEqual({ previous: null, current: null });
    expect(listener).toHaveBeenCalledTimes(21);
    expect(store.accept(motionMessage(20), 2_002)).toBe(false);
    expect(store.accept(motionMessage(19), 2_003)).toBe(false);
    expect(store.accept(motionMessage(21), 2_004)).toBe(true);
    unsubscribe();
  });

  it('keeps the latest visual pose while a drop command waits for its snapshot', () => {
    expect(commandRebasesMotion({ type: 'drop-held', point: { x: 520, y: 330 } })).toBe(false);
    expect(commandRebasesMotion({ type: 'cancel-held' })).toBe(false);
    expect(commandRebasesMotion({ type: 'retrieve-held' })).toBe(false);
    expect(commandRebasesMotion({ type: 'remove-held-structure' })).toBe(false);
  });

  it('rejects a held-item overlay older than the completed placement snapshot', () => {
    expect(shouldApplyInteractiveMotionOverlay(41, 42)).toBe(false);
    expect(shouldApplyInteractiveMotionOverlay(42, 42)).toBe(true);
    expect(shouldApplyInteractiveMotionOverlay(43, 42)).toBe(true);
  });
});

describe('simulation worker motion cadence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not shift or suppress motion samples when a full snapshot is published', async () => {
    vi.useFakeTimers();
    const messages: WorkerMessage[] = [];
    let receiveCommand: ((event: MessageEvent<SimulationCommand>) => void) | null = null;
    const workerScope = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'message') {
          receiveCommand = listener as (event: MessageEvent<SimulationCommand>) => void;
        }
      }),
      postMessage: vi.fn((message: WorkerMessage) => messages.push(message)),
    };
    vi.stubGlobal('self', workerScope);

    await import('../src/simulation/sim.worker');
    expect(receiveCommand).not.toBeNull();
    const send = (data: SimulationCommand): void => {
      receiveCommand?.({ data } as MessageEvent<SimulationCommand>);
    };

    send({ type: 'initialize', scenarioId: 'mission-4' });
    send({ type: 'pick-animal', speciesId: 'cherry-shrimp', point: { x: 500, y: 500 } });
    await vi.advanceTimersByTimeAsync(40);

    // This command publishes a full snapshot immediately. It must not reset or
    // consume the independent motion timer.
    send({ type: 'set-light-output', output: 72 });
    await vi.advanceTimersByTimeAsync(70);

    const motions = messages.filter(
      (message): message is WorkerMotionMessage => message.type === 'motion',
    );
    expect(motions).toHaveLength(3);
    expect(motions.map((motion) => motion.sequence)).toEqual([1, 2, 3]);
    for (let index = 1; index < motions.length; index += 1) {
      const interval = motions[index].sampledAtMs - motions[index - 1].sampledAtMs;
      // JavaScript timer implementations may quantize the repeating 33.33ms
      // interval to an integer millisecond.
      expect(Math.abs(interval - MOTION_SAMPLE_INTERVAL_MS)).toBeLessThan(1);
    }
    expect(messages.some((message) => message.type === 'snapshot')).toBe(true);
  });

  it('falls back to ordinary messages when fixed shared slots are too small', async () => {
    vi.useFakeTimers();
    const messages: WorkerMessage[] = [];
    let receiveCommand: ((event: MessageEvent<SimulationCommand>) => void) | null = null;
    const workerScope = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'message') {
          receiveCommand = listener as (event: MessageEvent<SimulationCommand>) => void;
        }
      }),
      postMessage: vi.fn((message: WorkerMessage) => messages.push(message)),
    };
    vi.stubGlobal('self', workerScope);

    await import('../src/simulation/sim.worker');
    expect(receiveCommand).not.toBeNull();
    const dispatch = (data: unknown): void => {
      receiveCommand?.({ data } as MessageEvent<SimulationCommand>);
    };
    dispatch({
      type: 'connect-telemetry',
      snapshot: createSharedTelemetryChannel(64),
      motion: createSharedTelemetryChannel(64),
      binaryMotion: createSharedMotionChannel(),
    });
    dispatch({ type: 'initialize', scenarioId: 'laboratory' });
    dispatch({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 500, y: 500 },
    });
    await vi.advanceTimersByTimeAsync(40);

    expect(messages.some((message) => message.type === 'snapshot')).toBe(true);
    const overlay = messages.find((message) => message.type === 'motion-overlay');
    expect(overlay).toMatchObject({
      type: 'motion-overlay',
      snapshotRevision: expect.any(Number),
      holding: { kind: 'animal' },
    });
    expect(overlay).not.toHaveProperty('animals');
    expect(overlay).not.toHaveProperty('structures');
  });

  it('represents pending time only as fixed 120 Hz quanta', () => {
    let pendingSeconds = addPendingWorkerTime(0, 0.1);
    const deltas: number[] = [];
    while (true) {
      const quantum = takeWorkerSimulationQuantum(pendingSeconds);
      if (!quantum) break;
      deltas.push(quantum.deltaSeconds);
      pendingSeconds = quantum.remainingSeconds;
    }

    expect(deltas).toHaveLength(12);
    for (const deltaSeconds of deltas) {
      expect(deltaSeconds).toBeCloseTo(WORKER_SIMULATION_QUANTUM_SECONDS, 10);
    }
    expect(pendingSeconds).toBeCloseTo(0, 10);
  });

  it('drops unattainable debt and positively yields when a quantum is slower than real time', () => {
    const slowWorkMs = WORKER_SIMULATION_QUANTUM_SECONDS * 1000 + 4;
    let clockMs = 0;
    let lastSchedulerAtMs = 0;
    let pendingSeconds = WORKER_SIMULATION_QUANTUM_SECONDS;
    let consecutiveImmediateCatchUps = 0;
    let executedQuanta = 0;
    let longestZeroDelayRun = 0;
    let currentZeroDelayRun = 0;
    let overloadYields = 0;

    for (let callback = 0; callback < 4_000; callback += 1) {
      const taskStartedAtMs = clockMs;
      const elapsedSeconds = (taskStartedAtMs - lastSchedulerAtMs) / 1000;
      lastSchedulerAtMs = taskStartedAtMs;
      pendingSeconds = addPendingWorkerTime(pendingSeconds, elapsedSeconds);
      const quantum = takeWorkerSimulationQuantum(pendingSeconds);

      if (!quantum) {
        consecutiveImmediateCatchUps = 0;
        const delayMs = Math.max(
          1,
          (WORKER_SIMULATION_QUANTUM_SECONDS - pendingSeconds) * 1000,
        );
        currentZeroDelayRun = 0;
        clockMs += delayMs;
        continue;
      }

      executedQuanta += 1;
      expect(quantum.deltaSeconds).toBe(WORKER_SIMULATION_QUANTUM_SECONDS);
      pendingSeconds = quantum.remainingSeconds;
      const taskFinishedAtMs = taskStartedAtMs + slowWorkMs;
      const continuation = planWorkerContinuation(
        pendingSeconds,
        taskFinishedAtMs - taskStartedAtMs,
        consecutiveImmediateCatchUps,
      );
      pendingSeconds = continuation.pendingSeconds;
      consecutiveImmediateCatchUps =
        continuation.consecutiveImmediateCatchUps;
      if (continuation.rebaseClock) {
        lastSchedulerAtMs = taskFinishedAtMs;
      }
      if (continuation.droppedDebt) {
        overloadYields += 1;
        expect(continuation.delayMs).toBe(WORKER_OVERLOAD_YIELD_MS);
        expect(pendingSeconds).toBe(0);
        expect(lastSchedulerAtMs).toBe(taskFinishedAtMs);
      }
      if (continuation.delayMs === 0) {
        currentZeroDelayRun += 1;
        longestZeroDelayRun = Math.max(
          longestZeroDelayRun,
          currentZeroDelayRun,
        );
      } else {
        currentZeroDelayRun = 0;
      }
      clockMs = taskFinishedAtMs + continuation.delayMs;
    }

    expect(executedQuanta).toBeGreaterThan(1_000);
    expect(overloadYields).toBe(executedQuanta);
    expect(longestZeroDelayRun).toBe(0);
    expect(clockMs).toBeGreaterThan(0);
  });

  it('bounds zero-delay catch-up even when old pending time is at the cap', () => {
    const fastWorkMs = 0.25;
    let clockMs = 0;
    let lastSchedulerAtMs = 0;
    let pendingSeconds = addPendingWorkerTime(0, 0.1);
    let consecutiveImmediateCatchUps = 0;
    let longestZeroDelayRun = 0;
    let currentZeroDelayRun = 0;
    let droppedDebt = 0;

    for (let callback = 0; callback < 2_000; callback += 1) {
      const taskStartedAtMs = clockMs;
      const elapsedSeconds = (taskStartedAtMs - lastSchedulerAtMs) / 1000;
      lastSchedulerAtMs = taskStartedAtMs;
      pendingSeconds = addPendingWorkerTime(pendingSeconds, elapsedSeconds);
      const quantum = takeWorkerSimulationQuantum(pendingSeconds);

      if (!quantum) {
        consecutiveImmediateCatchUps = 0;
        currentZeroDelayRun = 0;
        clockMs += Math.max(
          1,
          (WORKER_SIMULATION_QUANTUM_SECONDS - pendingSeconds) * 1000,
        );
        continue;
      }

      pendingSeconds = quantum.remainingSeconds;
      const taskFinishedAtMs = taskStartedAtMs + fastWorkMs;
      const continuation = planWorkerContinuation(
        pendingSeconds,
        fastWorkMs,
        consecutiveImmediateCatchUps,
      );
      pendingSeconds = continuation.pendingSeconds;
      consecutiveImmediateCatchUps =
        continuation.consecutiveImmediateCatchUps;
      if (continuation.rebaseClock) {
        lastSchedulerAtMs = taskFinishedAtMs;
      }
      if (continuation.droppedDebt) droppedDebt += 1;
      if (continuation.delayMs === 0) {
        currentZeroDelayRun += 1;
        longestZeroDelayRun = Math.max(
          longestZeroDelayRun,
          currentZeroDelayRun,
        );
      } else {
        currentZeroDelayRun = 0;
      }
      clockMs = taskFinishedAtMs + continuation.delayMs;
    }

    expect(droppedDebt).toBeGreaterThan(0);
    expect(longestZeroDelayRun).toBeLessThanOrEqual(
      MAX_WORKER_IMMEDIATE_CATCH_UP_TASKS,
    );
    expect(clockMs).toBeGreaterThan(0);
  });
});
