/// <reference lib="webworker" />

import { SimulationWorld } from './SimulationWorld';
import type {
  SimulationCommand,
  WorkerMotionMessage,
  WorkerSaveMessage,
  WorkerSnapshotMessage,
} from './types';
import { MOTION_SAMPLE_INTERVAL_MS } from './types';

const scope = self as DedicatedWorkerGlobalScope;
const world = new SimulationWorld('mission-1');
let lastTick = performance.now();
let motionSequence = 0;
let interactiveMotionDirty = false;

const publish = (): void => {
  const message: WorkerSnapshotMessage = {
    type: 'snapshot',
    snapshot: world.snapshot(),
  };
  scope.postMessage(message);
};

const publishMotion = (): void => {
  const sampledAtMs = performance.now();
  const motion = world.motionSnapshot();
  const message: WorkerMotionMessage = {
    type: 'motion',
    sequence: motionSequence += 1,
    sampledAtMs,
    ...motion,
  };
  scope.postMessage(message);
};

scope.addEventListener('message', (event: MessageEvent<SimulationCommand>) => {
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

setInterval(() => {
  const now = performance.now();
  const deltaSeconds = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (world.tick(deltaSeconds)) {
    publish();
  }
}, 1000 / 60);

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
