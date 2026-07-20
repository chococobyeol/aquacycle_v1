import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandRebasesMotion,
  createSimulationMotionStore,
} from '../src/renderer/hooks/useSimulation';
import {
  MOTION_SAMPLE_INTERVAL_MS,
  type SimulationCommand,
  type WorkerMessage,
  type WorkerMotionMessage,
} from '../src/simulation/types';

const motionMessage = (sequence: number): WorkerMotionMessage => ({
  type: 'motion',
  sequence,
  sampledAtMs: sequence * MOTION_SAMPLE_INTERVAL_MS,
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
});
