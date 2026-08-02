import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSharedMotionChannel,
  SHARED_MOTION_MAX_ANIMALS,
} from '../src/simulation/sharedMotionTelemetry';
import {
  createSharedTelemetryChannel,
  SharedTelemetryReader,
} from '../src/simulation/sharedTelemetry';
import type {
  WorkerMessage,
  WorkerMotionMessage,
  WorkerMotionOverlayMessage,
  WorkerSnapshotMessage,
  WorkerTelemetryResizeRequestMessage,
} from '../src/simulation/types';

interface WorkerHarness {
  dispatch: (data: unknown) => void;
  messages: WorkerMessage[];
}

const installWorkerHarness = async (
  clonePostedMessages = true,
): Promise<WorkerHarness> => {
  const messages: WorkerMessage[] = [];
  let receiveCommand: ((event: MessageEvent<unknown>) => void) | null = null;
  const workerScope = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'message') {
        receiveCommand = listener as (event: MessageEvent<unknown>) => void;
      }
    }),
    postMessage: vi.fn((message: WorkerMessage) => {
      messages.push(clonePostedMessages ? structuredClone(message) : message);
    }),
  };
  vi.stubGlobal('self', workerScope);
  await import('../src/simulation/sim.worker');
  expect(receiveCommand).not.toBeNull();
  return {
    dispatch: (data: unknown): void => {
      receiveCommand?.({ data } as MessageEvent<unknown>);
    },
    messages,
  };
};

describe('worker oversized telemetry fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('../src/simulation/SimulationWorld');
    vi.resetModules();
  });

  it('resizes fixed telemetry without structured-cloning an overflowing snapshot', async () => {
    vi.useFakeTimers();
    let revision = 0;
    let snapshotCalls = 0;

    vi.doMock('../src/simulation/SimulationWorld', () => ({
      SimulationWorld: class {
        public handle(command: { revision?: number }): void {
          if (command.revision !== undefined) revision = command.revision;
        }

        public tick(): boolean {
          return false;
        }

        public hasActiveMotion(): boolean {
          return false;
        }

        public snapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          snapshotCalls += 1;
          return Object.assign(reuse ?? {}, {
            scenarioId: 'laboratory',
            revision,
            padding: 'x'.repeat(512),
          });
        }

        public motionTransportSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return Object.assign(reuse ?? {}, {
            structures: [],
            animals: [],
            holding: null,
            probe: null,
          });
        }

        public motionSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return this.motionTransportSnapshot(reuse);
        }

        public exportSaveData(): Record<string, never> {
          return {};
        }
      },
    }));

    const harness = await installWorkerHarness();
    // Without a shared channel, ordinary worker messages remain immediate so
    // development-browser commands do not acquire a one-second acknowledgement
    // delay.
    harness.dispatch({ type: 'test-update', revision: 0 });
    expect(harness.messages).toHaveLength(1);
    expect(snapshotCalls).toBe(1);
    harness.messages.length = 0;
    snapshotCalls = 0;

    const undersizedChannel = createSharedTelemetryChannel(64);
    harness.dispatch({
      type: 'connect-telemetry',
      snapshot: undersizedChannel,
      motion: createSharedTelemetryChannel(64),
      binaryMotion: createSharedMotionChannel(),
    });

    harness.dispatch({ type: 'test-update', revision: 1 });
    for (let nextRevision = 2; nextRevision <= 101; nextRevision += 1) {
      harness.dispatch({ type: 'test-update', revision: nextRevision });
    }

    const ordinarySnapshots = harness.messages.filter(
      (message): message is WorkerSnapshotMessage => message.type === 'snapshot',
    );
    expect(ordinarySnapshots).toHaveLength(0);
    const resizeRequests = harness.messages.filter(
      (message): message is WorkerTelemetryResizeRequestMessage =>
        message.type === 'telemetry-resize-request',
    );
    expect(resizeRequests).toEqual([{
      type: 'telemetry-resize-request',
      stream: 'snapshot',
      minimumPayloadBytes: 128,
    }]);
    // Commands remain responsive, but the known-oversized graph is not rebuilt
    // or copied again while the renderer is replacing the fixed channel.
    expect(snapshotCalls).toBe(1);

    const resizedChannel = createSharedTelemetryChannel(4 * 1024);
    const resizedReader =
      new SharedTelemetryReader<WorkerSnapshotMessage>(resizedChannel);
    harness.dispatch({
      type: 'connect-telemetry',
      snapshot: resizedChannel,
      motion: createSharedTelemetryChannel(64),
      binaryMotion: createSharedMotionChannel(),
    });
    expect(snapshotCalls).toBe(2);
    expect(resizedReader.readLatest()).toMatchObject({
      type: 'snapshot',
      snapshot: { revision: 101 },
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(snapshotCalls).toBe(2);
  });

  it('keeps only the small overlay when binary motion exceeds capacity', async () => {
    vi.useFakeTimers();
    let activeMotion = true;
    let motionSnapshotCalls = 0;
    const oversizedAnimals = new Array(SHARED_MOTION_MAX_ANIMALS + 1).fill({});
    const holding = {
      kind: 'animal',
      source: 'inventory',
      valid: true,
      x: 480,
      y: 320,
      animalSpeciesId: 'daphnia',
    };

    vi.doMock('../src/simulation/SimulationWorld', () => ({
      SimulationWorld: class {
        public handle(): void {}

        public tick(): boolean {
          return false;
        }

        public hasActiveMotion(): boolean {
          return activeMotion;
        }

        public snapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return Object.assign(reuse ?? {}, {
            scenarioId: 'laboratory',
            revision: 0,
          });
        }

        public motionTransportSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return Object.assign(reuse ?? {}, {
            structures: [],
            animals: oversizedAnimals,
            holding,
            probe: null,
          });
        }

        public motionSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          motionSnapshotCalls += 1;
          return this.motionTransportSnapshot(reuse);
        }

        public exportSaveData(): Record<string, never> {
          return {};
        }
      },
    }));

    // Keep message identity so an accidental giant ordinary fallback remains
    // cheap enough for this regression harness to detect.
    const harness = await installWorkerHarness(false);
    const motionChannel = createSharedTelemetryChannel(4 * 1024);
    const overlayReader =
      new SharedTelemetryReader<WorkerMotionOverlayMessage>(motionChannel);
    harness.dispatch({
      type: 'connect-telemetry',
      snapshot: createSharedTelemetryChannel(64),
      motion: motionChannel,
      binaryMotion: createSharedMotionChannel(),
    });

    await vi.advanceTimersByTimeAsync(110);
    const firstBurst = harness.messages.filter(
      (message): message is WorkerMotionMessage => message.type === 'motion',
    );
    expect(firstBurst).toHaveLength(0);
    expect(motionSnapshotCalls).toBe(0);
    const latestOverlay = overlayReader.readLatest();
    expect(latestOverlay).toMatchObject({
      type: 'motion-overlay',
      sequence: 3,
      holding: { kind: 'animal', animalSpeciesId: 'daphnia' },
    });
    expect(latestOverlay).not.toHaveProperty('animals');
    expect(latestOverlay).not.toHaveProperty('structures');
    expect(overlayReader.readLatest()).toBeNull();

    // Oversized binary motion never falls back to a giant ordinary message.
    // The bounded full snapshot stream remains the coarse visual fallback.
    activeMotion = false;
    await vi.advanceTimersByTimeAsync(1_000);
    const completedFallbacks = harness.messages.filter(
      (message): message is WorkerMotionMessage => message.type === 'motion',
    );
    expect(completedFallbacks).toHaveLength(0);
    expect(motionSnapshotCalls).toBe(0);
  });

  it('keeps the scheduler and command channel alive after a tick fault', async () => {
    vi.useFakeTimers();
    let tickCalls = 0;
    const handledCommands: string[] = [];

    vi.doMock('../src/simulation/SimulationWorld', () => ({
      SimulationWorld: class {
        public handle(command: { type: string }): void {
          handledCommands.push(command.type);
        }

        public tick(): boolean {
          tickCalls += 1;
          if (tickCalls === 1) throw new Error('synthetic ecology fault');
          return false;
        }

        public hasActiveMotion(): boolean {
          return false;
        }

        public snapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return Object.assign(reuse ?? {}, {
            scenarioId: 'laboratory',
            revision: tickCalls,
          });
        }

        public motionTransportSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return Object.assign(reuse ?? {}, {
            structures: [],
            animals: [],
            holding: null,
            probe: null,
          });
        }

        public motionSnapshot(reuse?: Record<string, unknown>): Record<string, unknown> {
          return this.motionTransportSnapshot(reuse);
        }

        public exportSaveData(): Record<string, never> {
          return {};
        }
      },
    }));

    const harness = await installWorkerHarness();
    harness.dispatch({
      type: 'connect-telemetry',
      snapshot: createSharedTelemetryChannel(4 * 1024),
      motion: createSharedTelemetryChannel(4 * 1024),
      binaryMotion: createSharedMotionChannel(),
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(tickCalls).toBe(1);
    expect(harness.messages).toContainEqual(expect.objectContaining({
      type: 'worker-fault',
      operation: 'simulation-tick',
      message: 'synthetic ecology fault',
    }));

    harness.dispatch({ type: 'set-speed', speed: 8 });
    expect(handledCommands).toContain('set-speed');

    await vi.advanceTimersByTimeAsync(1_010);
    expect(tickCalls).toBeGreaterThan(1);
  });
});
