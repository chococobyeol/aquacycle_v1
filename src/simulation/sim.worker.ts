/// <reference lib="webworker" />

import { SimulationWorld } from './SimulationWorld';
import {
  SharedTelemetryWriter,
  type SharedTelemetryChannel,
} from './sharedTelemetry';
import {
  sharedMotionMessageFitsChannel,
  SharedMotionWriter,
  type SharedMotionChannel,
} from './sharedMotionTelemetry';
import type {
  SimulationCommand,
  SimulationSnapshot,
  WorkerMotionMessage,
  WorkerMotionOverlayMessage,
  WorkerSaveMessage,
  WorkerSnapshotMessage,
} from './types';
import { MOTION_SAMPLE_INTERVAL_MS } from './types';
import {
  addPendingWorkerTime,
  planWorkerContinuation,
  takeWorkerSimulationQuantum,
  WORKER_SIMULATION_QUANTUM_SECONDS,
} from './workerCadence';

const scope = self as DedicatedWorkerGlobalScope;
const world = new SimulationWorld('mission-1');
let lastSchedulerAtMs = performance.now();
let pendingRealSeconds = 0;
let consecutiveImmediateCatchUps = 0;
let motionSequence = 0;
let interactiveMotionDirty = false;
let snapshotTelemetry: SharedTelemetryWriter | null = null;
let motionTelemetry: SharedTelemetryWriter | null = null;
let binaryMotionTelemetry: SharedMotionWriter | null = null;
let reusableMotion = world.motionTransportSnapshot();
let reusableSnapshot: SimulationSnapshot | undefined;
let snapshotFallbackMode = false;
let lastSnapshotFallbackAtMs = Number.NEGATIVE_INFINITY;
let pendingSnapshotFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let lastOversizedMotionFallbackAtMs = Number.NEGATIVE_INFINITY;
let pendingOversizedMotionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOversizedMotionSequence = 0;
const LARGE_TELEMETRY_FALLBACK_INTERVAL_MS = 1_000;

interface ConnectTelemetryCommand {
  type: 'connect-telemetry';
  snapshot: SharedTelemetryChannel;
  motion: SharedTelemetryChannel;
  binaryMotion: SharedMotionChannel;
}

type WorkerCommand = SimulationCommand | ConnectTelemetryCommand;

const attemptSnapshotPublication = (): void => {
  reusableSnapshot = world.snapshot(reusableSnapshot);
  const message: WorkerSnapshotMessage = {
    type: 'snapshot',
    snapshot: reusableSnapshot,
  };
  if (!snapshotTelemetry) {
    // SharedArrayBuffer can be unavailable in a development browser. Preserve
    // the ordinary worker channel's existing immediate command acknowledgement
    // semantics; only a confirmed fixed-slot overflow enters the coalescing
    // backoff below.
    snapshotFallbackMode = false;
    scope.postMessage(message);
    return;
  }
  if (snapshotTelemetry.publish(message)) {
    snapshotFallbackMode = false;
    return;
  }

  // A population spike must not silently stop every future HUD update and
  // command acknowledgement. The fixed shared slot is the normal path; an
  // exceptional oversized generation is coalesced into at most one ordinary
  // structured-clone per real second. While that backoff is active, `publish`
  // does not rebuild and re-encode the same oversized graph on every simulated
  // second at 64x.
  snapshotFallbackMode = true;
  lastSnapshotFallbackAtMs = performance.now();
  scope.postMessage(message);
};

const flushPendingSnapshotFallback = (): void => {
  pendingSnapshotFallbackTimer = null;
  attemptSnapshotPublication();
};

const publish = (): void => {
  if (pendingSnapshotFallbackTimer !== null) return;
  const fallbackDelayMs = LARGE_TELEMETRY_FALLBACK_INTERVAL_MS -
    (performance.now() - lastSnapshotFallbackAtMs);
  if (snapshotFallbackMode && fallbackDelayMs > 0) {
    pendingSnapshotFallbackTimer = setTimeout(
      flushPendingSnapshotFallback,
      fallbackDelayMs,
    );
    return;
  }
  attemptSnapshotPublication();
};

const publishMotionOverlay = (message: WorkerMotionMessage): void => {
  if (!message.holding && !message.probe) return;
  const overlay: WorkerMotionOverlayMessage = {
    type: 'motion-overlay',
    sequence: message.sequence,
    sampledAtMs: message.sampledAtMs,
    holding: message.holding,
    probe: message.probe,
  };
  const sharedPublished = motionTelemetry?.publish(overlay) ?? false;
  if (!sharedPublished) scope.postMessage(overlay);
};

const flushPendingOversizedMotionFallback = (): void => {
  pendingOversizedMotionFallbackTimer = null;
  if (pendingOversizedMotionSequence === 0) return;
  reusableMotion = world.motionSnapshot(reusableMotion);
  const message: WorkerMotionMessage = {
    type: 'motion',
    sequence: pendingOversizedMotionSequence,
    // `motionSnapshot` reads the pose now, not when the rejected binary sample
    // originally queued this trailing fallback.
    sampledAtMs: performance.now(),
    ...reusableMotion,
  };
  pendingOversizedMotionSequence = 0;
  lastOversizedMotionFallbackAtMs = performance.now();
  scope.postMessage(message);
};

const queueOversizedMotionFallback = (sequence: number): void => {
  pendingOversizedMotionSequence = sequence;
  const fallbackDelayMs = LARGE_TELEMETRY_FALLBACK_INTERVAL_MS -
    (performance.now() - lastOversizedMotionFallbackAtMs);
  if (fallbackDelayMs <= 0) {
    if (pendingOversizedMotionFallbackTimer !== null) {
      clearTimeout(pendingOversizedMotionFallbackTimer);
      pendingOversizedMotionFallbackTimer = null;
    }
    flushPendingOversizedMotionFallback();
    return;
  }
  if (pendingOversizedMotionFallbackTimer === null) {
    pendingOversizedMotionFallbackTimer = setTimeout(
      flushPendingOversizedMotionFallback,
      fallbackDelayMs,
    );
  }
};

const cancelOversizedMotionFallback = (): void => {
  if (pendingOversizedMotionFallbackTimer !== null) {
    clearTimeout(pendingOversizedMotionFallbackTimer);
    pendingOversizedMotionFallbackTimer = null;
  }
  pendingOversizedMotionSequence = 0;
  lastOversizedMotionFallbackAtMs = Number.NEGATIVE_INFINITY;
};

const publishMotion = (): void => {
  const sampledAtMs = performance.now();
  const motion = world.motionTransportSnapshot(reusableMotion);
  reusableMotion = motion;
  const message: WorkerMotionMessage = {
    type: 'motion',
    sequence: motionSequence += 1,
    sampledAtMs,
    ...motion,
  };
  if (!binaryMotionTelemetry) {
    if (!sharedMotionMessageFitsChannel(message)) {
      queueOversizedMotionFallback(message.sequence);
      publishMotionOverlay(message);
      return;
    }
    cancelOversizedMotionFallback();
    reusableMotion = world.motionSnapshot(reusableMotion);
    message.structures = reusableMotion.structures;
    message.animals = reusableMotion.animals;
    message.holding = reusableMotion.holding;
    message.probe = reusableMotion.probe;
    const sharedPublished = motionTelemetry?.publish(message) ?? false;
    if (!sharedPublished) scope.postMessage(message);
    return;
  }
  const binaryPublished = binaryMotionTelemetry.publish(message);
  if (!binaryPublished) {
    // An extreme population beyond the fixed binary capacity still receives
    // the newest coarse full pose, but never structured-clones the giant graph
    // at 30 Hz. A scheduled trailing publication preserves the final pose even
    // when autonomous motion stops before the next interval callback.
    queueOversizedMotionFallback(message.sequence);
    publishMotionOverlay(message);
    return;
  }
  cancelOversizedMotionFallback();
  // Holding/probe records are not part of the numeric motion layout. Send only
  // that small metadata beside the successful binary sample; duplicating every
  // animal into the generic channel could overflow and structured-clone the
  // whole population at 30 Hz while a probe or held item is active.
  publishMotionOverlay(message);
};

scope.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  if (event.data.type === 'connect-telemetry') {
    snapshotTelemetry = new SharedTelemetryWriter(event.data.snapshot);
    motionTelemetry = new SharedTelemetryWriter(event.data.motion);
    binaryMotionTelemetry = new SharedMotionWriter(event.data.binaryMotion);
    return;
  }
  if (event.data.type === 'export-save') {
    const message: WorkerSaveMessage = {
      type: 'save-data',
      requestId: event.data.requestId,
      data: world.exportSaveData(),
    };
    scope.postMessage(message);
    return;
  }
  world.handle(event.data);
  if (event.data.type === 'pointer-move' || event.data.type === 'probe') {
    interactiveMotionDirty = true;
  } else {
    publish();
  }
});

/**
 * Run at most one small, fixed simulation quantum per worker task.
 *
 * The old repeating 60 Hz timer passed the whole wall-clock delay back into
 * `world.tick()`. At 64x, one expensive ecology pass could therefore turn the
 * next pass into several seconds of catch-up work, which delayed the separate
 * motion timer by hundreds of milliseconds. A bounded number of zero-delay
 * continuations can recover ordinary timer jitter. If a quantum is already
 * slower than real time, the worker drops unattainable debt and positively
 * yields so commands and the independent 30 Hz motion publisher keep running.
 */
const scheduleSimulation = (): void => {
  const taskStartedAtMs = performance.now();
  const elapsedSeconds = (taskStartedAtMs - lastSchedulerAtMs) / 1000;
  lastSchedulerAtMs = taskStartedAtMs;
  pendingRealSeconds = addPendingWorkerTime(pendingRealSeconds, elapsedSeconds);

  const quantum = takeWorkerSimulationQuantum(pendingRealSeconds);
  if (quantum) {
    pendingRealSeconds = quantum.remainingSeconds;
    if (world.tick(quantum.deltaSeconds)) {
      publish();
    }
    const taskFinishedAtMs = performance.now();
    const continuation = planWorkerContinuation(
      pendingRealSeconds,
      taskFinishedAtMs - taskStartedAtMs,
      consecutiveImmediateCatchUps,
    );
    pendingRealSeconds = continuation.pendingSeconds;
    consecutiveImmediateCatchUps =
      continuation.consecutiveImmediateCatchUps;
    if (continuation.rebaseClock) {
      lastSchedulerAtMs = taskFinishedAtMs;
    }
    setTimeout(scheduleSimulation, continuation.delayMs);
    return;
  }

  consecutiveImmediateCatchUps = 0;
  const waitMs = Math.max(
    1,
    (WORKER_SIMULATION_QUANTUM_SECONDS - pendingRealSeconds) * 1000,
  );
  setTimeout(scheduleSimulation, waitMs);
};

setTimeout(() => {
  lastSchedulerAtMs = performance.now();
  pendingRealSeconds = WORKER_SIMULATION_QUANTUM_SECONDS;
  consecutiveImmediateCatchUps = 0;
  scheduleSimulation();
}, WORKER_SIMULATION_QUANTUM_SECONDS * 1000);

// Motion has one real-time transport cadence. It deliberately runs separately
// from full snapshots: a full ecology publication must not create a missing or
// short motion interval, and simulation speed must not alter presentation FPS.
setInterval(() => {
  if (!world.hasActiveMotion() && !interactiveMotionDirty) return;
  interactiveMotionDirty = false;
  publishMotion();
}, MOTION_SAMPLE_INTERVAL_MS);

// The renderer always sends an explicit initialize command. Publishing the
// constructor's mission-1 snapshot here can briefly mix mission-1 resources
// into another mission's screen before that command is handled.
