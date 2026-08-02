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
  WorkerFaultMessage,
  WorkerTelemetryResizeRequestMessage,
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
let snapshotResizePending = false;
let snapshotResizeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let motionOverflowReported = false;
const SNAPSHOT_RESIZE_RETRY_MS = 5_000;

interface ConnectTelemetryCommand {
  type: 'connect-telemetry';
  snapshot: SharedTelemetryChannel;
  motion: SharedTelemetryChannel;
  binaryMotion: SharedMotionChannel;
}

type WorkerCommand = SimulationCommand | ConnectTelemetryCommand;

const attemptSnapshotPublication = (): void => {
  if (snapshotResizePending) return;
  reusableSnapshot = world.snapshot(reusableSnapshot);
  const message: WorkerSnapshotMessage = {
    type: 'snapshot',
    snapshot: reusableSnapshot,
  };
  if (!snapshotTelemetry) {
    // SharedArrayBuffer can be unavailable in a development browser. Preserve
    // the ordinary worker channel's existing immediate command acknowledgement
    // semantics there. Electron uses the bounded shared channel below.
    scope.postMessage(message);
    return;
  }
  if (snapshotTelemetry.publish(message)) {
    return;
  }

  // Never structured-clone the oversized graph. Chromium retains backing
  // regions from those clones on macOS, so a long population bloom can grow the
  // renderer to several GB even though the JS heap remains small. Ask the
  // renderer for a larger reusable triple buffer using a tiny control packet.
  snapshotResizePending = true;
  if (snapshotResizeRetryTimer === null) {
    snapshotResizeRetryTimer = setTimeout(() => {
      snapshotResizeRetryTimer = null;
      snapshotResizePending = false;
      try {
        attemptSnapshotPublication();
      } catch (error) {
        postWorkerFault('command', error);
      }
    }, SNAPSHOT_RESIZE_RETRY_MS);
  }
  const resizeRequest: WorkerTelemetryResizeRequestMessage = {
    type: 'telemetry-resize-request',
    stream: 'snapshot',
    minimumPayloadBytes: snapshotTelemetry.payloadByteLength * 2,
  };
  scope.postMessage(resizeRequest);
};

const publish = (): void => {
  attemptSnapshotPublication();
};

const publishMotionOverlay = (message: WorkerMotionMessage): void => {
  if (!message.holding && !message.probe) return;
  const overlay: WorkerMotionOverlayMessage = {
    type: 'motion-overlay',
    sequence: message.sequence,
    sampledAtMs: message.sampledAtMs,
    snapshotRevision: message.snapshotRevision,
    holding: message.holding,
    probe: message.probe,
  };
  const sharedPublished = motionTelemetry?.publish(overlay) ?? false;
  if (!sharedPublished) scope.postMessage(overlay);
};

const publishMotion = (): void => {
  const sampledAtMs = performance.now();
  const motion = world.motionTransportSnapshot(reusableMotion);
  reusableMotion = motion;
  const message: WorkerMotionMessage = {
    type: 'motion',
    sequence: motionSequence += 1,
    sampledAtMs,
    snapshotRevision: reusableSnapshot?.revision ?? 0,
    ...motion,
  };
  if (!binaryMotionTelemetry) {
    if (!sharedMotionMessageFitsChannel(message)) {
      publishMotionOverlay(message);
      return;
    }
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
    // Do not turn an extreme population into a giant ordinary postMessage.
    // Full snapshots continue to provide a coarse pose while the binary stream
    // is over capacity.
    publishMotionOverlay(message);
    if (!motionOverflowReported) {
      motionOverflowReported = true;
      const fault: WorkerFaultMessage = {
        type: 'worker-fault',
        operation: 'command',
        message: 'Motion telemetry capacity exceeded; using snapshot poses.',
      };
      scope.postMessage(fault);
    }
    return;
  }
  motionOverflowReported = false;
  // Holding/probe records are not part of the numeric motion layout. Send only
  // that small metadata beside the successful binary sample; duplicating every
  // animal into the generic channel could overflow and structured-clone the
  // whole population at 30 Hz while a probe or held item is active.
  publishMotionOverlay(message);
};

const postWorkerFault = (
  operation: WorkerFaultMessage['operation'],
  error: unknown,
): void => {
  const fault: WorkerFaultMessage = {
    type: 'worker-fault',
    operation,
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
  scope.postMessage(fault);
};

scope.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  try {
    if (event.data.type === 'connect-telemetry') {
      snapshotTelemetry = new SharedTelemetryWriter(event.data.snapshot);
      motionTelemetry = new SharedTelemetryWriter(event.data.motion);
      binaryMotionTelemetry = new SharedMotionWriter(event.data.binaryMotion);
      if (snapshotResizeRetryTimer !== null) {
        clearTimeout(snapshotResizeRetryTimer);
        snapshotResizeRetryTimer = null;
      }
      snapshotResizePending = false;
      attemptSnapshotPublication();
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
  } catch (error) {
    postWorkerFault(
      event.data.type === 'export-save' ? 'export-save' : 'command',
      error,
    );
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
  let nextDelayMs = WORKER_SIMULATION_QUANTUM_SECONDS * 1000;
  try {
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
      nextDelayMs = continuation.delayMs;
    } else {
      consecutiveImmediateCatchUps = 0;
      nextDelayMs = Math.max(
        1,
        (WORKER_SIMULATION_QUANTUM_SECONDS - pendingRealSeconds) * 1000,
      );
    }
  } catch (error) {
    // One model exception must not kill the only recurring scheduler callback.
    // Drop accumulated catch-up debt, report the fault, and leave the worker
    // event loop responsive to pause/reset/speed commands.
    pendingRealSeconds = 0;
    consecutiveImmediateCatchUps = 0;
    lastSchedulerAtMs = performance.now();
    nextDelayMs = 1_000;
    postWorkerFault('simulation-tick', error);
  }
  setTimeout(scheduleSimulation, nextDelayMs);
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
  try {
    if (!world.hasActiveMotion() && !interactiveMotionDirty) return;
    interactiveMotionDirty = false;
    publishMotion();
  } catch (error) {
    postWorkerFault('command', error);
  }
}, MOTION_SAMPLE_INTERVAL_MS);

// The renderer always sends an explicit initialize command. Publishing the
// constructor's mission-1 snapshot here can briefly mix mission-1 resources
// into another mission's screen before that command is handled.
