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

  it('coalesces an overflowing full snapshot and eventually publishes the latest state', async () => {
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

    harness.dispatch({
      type: 'connect-telemetry',
      snapshot: createSharedTelemetryChannel(64),
      motion: createSharedTelemetryChannel(64),
      binaryMotion: createSharedMotionChannel(),
    });

    harness.dispatch({ type: 'test-update', revision: 1 });
    for (let nextRevision = 2; nextRevision <= 101; nextRevision += 1) {
      harness.dispatch({ type: 'test-update', revision: nextRevision });
    }

    const immediateSnapshots = harness.messages.filter(
      (message): message is WorkerSnapshotMessage => message.type === 'snapshot',
    );
    expect(immediateSnapshots).toHaveLength(1);
    expect(immediateSnapshots[0].snapshot.revision).toBe(1);
    // The 100 coalesced updates neither rebuild nor retry encoding the known
    // oversized graph while the real-time fallback window is active.
    expect(snapshotCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(snapshotCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    const eventualSnapshots = harness.messages.filter(
      (message): message is WorkerSnapshotMessage => message.type === 'snapshot',
    );
    expect(eventualSnapshots).toHaveLength(2);
    expect(eventualSnapshots[1].snapshot.revision).toBe(101);
    expect(snapshotCalls).toBe(2);
  });

  it('rate-limits binary overflow while preserving its trailing pose and small overlay', async () => {
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

    // Avoid cloning the deliberately oversized repeated array in the harness;
    // real postMessage performs that clone, whose call frequency is what this
    // regression test bounds.
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
    expect(firstBurst).toHaveLength(1);
    expect(motionSnapshotCalls).toBe(1);
    const latestOverlay = overlayReader.readLatest();
    expect(latestOverlay).toMatchObject({
      type: 'motion-overlay',
      sequence: 3,
      holding: { kind: 'animal', animalSpeciesId: 'daphnia' },
    });
    expect(latestOverlay).not.toHaveProperty('animals');
    expect(latestOverlay).not.toHaveProperty('structures');
    expect(overlayReader.readLatest()).toBeNull();

    // If motion stops inside the one-second backoff, the scheduled trailing
    // publication must still deliver the latest rejected sequence.
    activeMotion = false;
    await vi.advanceTimersByTimeAsync(1_000);
    const completedFallbacks = harness.messages.filter(
      (message): message is WorkerMotionMessage => message.type === 'motion',
    );
    expect(completedFallbacks).toHaveLength(2);
    expect(completedFallbacks[1].sequence).toBe(3);
    expect(completedFallbacks[1].sequence).toBeGreaterThan(
      completedFallbacks[0].sequence,
    );
    expect(completedFallbacks[1].sampledAtMs).toBeGreaterThanOrEqual(1_000);
    expect(motionSnapshotCalls).toBe(2);
  });
});
