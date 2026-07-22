import { useCallback, useEffect, useRef, useState } from 'react';
import SimulationWorker from '../../simulation/sim.worker?worker&inline';
import type {
  HoldingSnapshot,
  ProbeSnapshot,
  ScenarioId,
  SimulationCommand,
  SimulationSaveData,
  SimulationSnapshot,
  StructureSnapshot,
  AnimalSnapshot,
  WorkerMotionMessage,
  WorkerMessage,
} from '../../simulation/types';
import {
  createSharedTelemetryChannel,
  SharedTelemetryReader,
  sharedTelemetryAvailable,
} from '../../simulation/sharedTelemetry';
import {
  createSharedMotionChannel,
  SharedMotionReader,
} from '../../simulation/sharedMotionTelemetry';

export interface SimulationMotionFrame {
  sequence: number;
  sampledAtMs: number;
  /** Renderer `performance.now()` when this packet was delivered. */
  receivedAtMs: number;
  structures: StructureSnapshot[];
  animals: AnimalSnapshot[];
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

export interface SimulationMotionFrames {
  previous: SimulationMotionFrame | null;
  current: SimulationMotionFrame | null;
}

export interface SimulationMotionSource {
  /** Returns a bounded two-sample window; it never accumulates a history. */
  getFrames: () => SimulationMotionFrames;
  /** Notifies imperative renderers without scheduling a React render. */
  subscribe: (listener: () => void) => () => void;
}

export interface SimulationMotionStore extends SimulationMotionSource {
  accept: (message: WorkerMotionMessage, receivedAtMs: number) => boolean;
  /** Clears render samples while retaining the last accepted sequence barrier. */
  clear: () => void;
  /** Clears both samples and sequence state when a brand-new worker is created. */
  reset: () => void;
}

const EMPTY_MOTION_FRAMES: SimulationMotionFrames = {
  previous: null,
  current: null,
};

/**
 * Small external store used by the Pixi renderer. Motion packets used to be
 * merged into React state, causing the whole simulation screen to render for
 * every animal sample. This store retains only the interpolation window and
 * rejects delayed/out-of-order packets.
 */
export const createSimulationMotionStore = (): SimulationMotionStore => {
  const frames: SimulationMotionFrames = { ...EMPTY_MOTION_FRAMES };
  let highestSequence = 0;
  const listeners = new Set<() => void>();

  const publishEmptyFrames = (): void => {
    if (!frames.current && !frames.previous) return;
    frames.previous = null;
    frames.current = null;
    for (const listener of listeners) listener();
  };

  return {
    getFrames: () => frames,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accept: (message, receivedAtMs) => {
      if (message.sequence <= highestSequence) return false;
      highestSequence = message.sequence;
      const current = message as WorkerMotionMessage & { receivedAtMs: number };
      current.receivedAtMs = receivedAtMs;
      frames.previous = frames.current;
      frames.current = current;
      for (const listener of listeners) listener();
      return true;
    },
    clear: publishEmptyFrames,
    reset: () => {
      highestSequence = 0;
      publishEmptyFrames();
    },
  };
};

export interface SimulationController {
  snapshot: SimulationSnapshot | null;
  motionSource: SimulationMotionSource;
  send: (command: SimulationCommand) => void;
  requestSave: () => Promise<SimulationSaveData>;
  loadSave: (data: SimulationSaveData) => void;
}

export const commandRebasesMotion = (command: SimulationCommand): boolean => {
  switch (command.type) {
    case 'initialize':
    case 'reset':
    case 'start':
    case 'pause':
    case 'resume':
    case 'set-speed':
    case 'load-save':
    case 'pick-structure':
    case 'pick-seed':
    case 'pick-animal':
    case 'pick-biofilm':
    case 'pick-at':
    case 'rotate-held':
    case 'retrieve-structure':
    case 'retrieve-animal':
      return true;
    default:
      return false;
  }
};

const sameHoldingIdentity = (
  first: HoldingSnapshot | null,
  second: HoldingSnapshot | null,
): boolean => {
  if (!first || !second) return first === second;
  if (first.kind !== second.kind || first.source !== second.source) return false;
  switch (first.kind) {
    case 'structure': return first.structureId === second.structureId;
    case 'animal': return first.animalId === second.animalId;
    case 'seed': return first.speciesId === second.speciesId;
    case 'biofilm': return first.microbeGuildId === second.microbeGuildId;
  }
};

export const useSimulation = (scenarioId: ScenarioId): SimulationController => {
  const workerRef = useRef<Worker | null>(null);
  const saveRequestSequence = useRef(0);
  const saveRequests = useRef(new Map<number, {
    resolve: (data: SimulationSaveData) => void;
    reject: (reason: Error) => void;
  }>());
  const [motionStore] = useState(createSimulationMotionStore);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);

  useEffect(() => {
    motionStore.reset();
    // An inline worker becomes a same-origin Blob in packaged file:// builds.
    // A separate worker asset is blocked by Chromium's COEP enforcement there,
    // even though the development server can attach the required HTTP header.
    const worker = new SimulationWorker();
    workerRef.current = worker;
    motionStore.clear();
    let telemetryAnimationFrame: number | null = null;

    const receiveWorkerMessage = (message: WorkerMessage): void => {
      if (message.type === 'snapshot') {
        if (message.snapshot.scenarioId !== scenarioId) return;
        const bufferedHolding = motionStore.getFrames().current?.holding ?? null;
        if (!sameHoldingIdentity(bufferedHolding, message.snapshot.holding)) {
          // A full snapshot is the acknowledgement for pick/drop/cancel. Motion
          // from the prior holding state must never repaint an older cursor pose.
          motionStore.clear();
        }
        setSnapshot(message.snapshot);
      } else if (message.type === 'save-data') {
        const pending = saveRequests.current.get(message.requestId);
        if (!pending) return;
        saveRequests.current.delete(message.requestId);
        pending.resolve(message.data);
      } else {
        const motion = message;
        motionStore.accept(motion, performance.now());

        // These two values are also rendered by small DOM overlays outside the
        // Pixi canvas. Keep those overlays live while autonomous animal and
        // structure motion stays entirely outside React state.
        if (motion.holding || motion.probe) {
          setSnapshot((current) => current ? {
            ...current,
            holding: motion.holding,
            probe: motion.probe,
          } : current);
        }
      }
    };

    const receivePostedMessage = (event: MessageEvent<WorkerMessage>): void => {
      receiveWorkerMessage(event.data);
    };

    worker.addEventListener('message', receivePostedMessage);
    if (sharedTelemetryAvailable()) {
      try {
        const snapshotChannel = createSharedTelemetryChannel();
        const interactiveMotionChannel = createSharedTelemetryChannel();
        const binaryMotionChannel = createSharedMotionChannel();
        const snapshotReader = new SharedTelemetryReader<WorkerMessage>(snapshotChannel);
        const interactiveMotionReader = new SharedTelemetryReader<WorkerMessage>(
          interactiveMotionChannel,
        );
        const binaryMotionReader = new SharedMotionReader(binaryMotionChannel);
        worker.postMessage({
          type: 'connect-telemetry',
          snapshot: snapshotChannel,
          motion: interactiveMotionChannel,
          binaryMotion: binaryMotionChannel,
        });

        const pollTelemetry = (): void => {
          // Apply topology first, then the newest motion for that topology. Both
          // channels coalesce naturally when a busy frame cannot keep up.
          const snapshotMessage = snapshotReader.readLatest();
          if (snapshotMessage) receiveWorkerMessage(snapshotMessage);
          // Interactive packets contain the pointer-held item or probe and
          // intentionally win when both channels carry the same sequence.
          const interactiveMotionMessage = interactiveMotionReader.readLatest();
          if (interactiveMotionMessage) receiveWorkerMessage(interactiveMotionMessage);
          const binaryMotionMessage = binaryMotionReader.readLatest();
          if (binaryMotionMessage) receiveWorkerMessage(binaryMotionMessage);
          telemetryAnimationFrame = requestAnimationFrame(pollTelemetry);
        };
        telemetryAnimationFrame = requestAnimationFrame(pollTelemetry);
      } catch (error) {
        // Development servers without cross-origin isolation hide or reject
        // SharedArrayBuffer. The ordinary worker channel remains a functional
        // fallback instead of leaving the aquarium uninitialized.
        console.warn('[AquaCycle] Shared telemetry unavailable; using worker messages.', error);
      }
    }
    worker.postMessage({ type: 'initialize', scenarioId } satisfies SimulationCommand);

    return () => {
      worker.removeEventListener('message', receivePostedMessage);
      if (telemetryAnimationFrame !== null) cancelAnimationFrame(telemetryAnimationFrame);
      worker.terminate();
      workerRef.current = null;
      for (const pending of saveRequests.current.values()) {
        pending.reject(new Error('시뮬레이션이 닫혀 저장을 완료하지 못했습니다.'));
      }
      saveRequests.current.clear();
      motionStore.reset();
    };
  }, [motionStore, scenarioId]);

  const send = useCallback((command: SimulationCommand): void => {
    // Topology, phase, or integration-speed changes begin a fresh interpolation
    // window. Replaying the last 64x sample after switching to 1x caused the
    // renderer to chase a stale target even though the worker was already stable.
    if (commandRebasesMotion(command)) motionStore.clear();
    workerRef.current?.postMessage(command);
  }, [motionStore]);

  const requestSave = useCallback((): Promise<SimulationSaveData> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('아직 수조가 준비되지 않았습니다.'));
    const requestId = saveRequestSequence.current += 1;
    return new Promise<SimulationSaveData>((resolve, reject) => {
      saveRequests.current.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'export-save', requestId } satisfies SimulationCommand);
    });
  }, []);

  const loadSave = useCallback((data: SimulationSaveData): void => {
    motionStore.clear();
    workerRef.current?.postMessage({ type: 'load-save', data } satisfies SimulationCommand);
  }, [motionStore]);

  return { snapshot, motionSource: motionStore, send, requestSave, loadSave };
};
