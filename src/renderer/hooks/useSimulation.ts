import { useCallback, useEffect, useRef, useState } from 'react';
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
  let frames = EMPTY_MOTION_FRAMES;
  let highestSequence = 0;
  const listeners = new Set<() => void>();

  const publishEmptyFrames = (): void => {
    if (!frames.current && !frames.previous) return;
    frames = EMPTY_MOTION_FRAMES;
    for (const listener of [...listeners]) listener();
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
      const { type: _type, ...sample } = message;
      const current: SimulationMotionFrame = { ...sample, receivedAtMs };
      frames = { previous: frames.current, current };
      for (const listener of [...listeners]) listener();
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
    const worker = new Worker(
      new URL('../../simulation/sim.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    motionStore.clear();

    const receiveSnapshot = (event: MessageEvent<WorkerMessage>): void => {
      if (event.data.type === 'snapshot') {
        if (event.data.snapshot.scenarioId !== scenarioId) return;
        const bufferedHolding = motionStore.getFrames().current?.holding ?? null;
        if (!sameHoldingIdentity(bufferedHolding, event.data.snapshot.holding)) {
          // A full snapshot is the acknowledgement for pick/drop/cancel. Motion
          // from the prior holding state must never repaint an older cursor pose.
          motionStore.clear();
        }
        setSnapshot(event.data.snapshot);
      } else if (event.data.type === 'save-data') {
        const pending = saveRequests.current.get(event.data.requestId);
        if (!pending) return;
        saveRequests.current.delete(event.data.requestId);
        pending.resolve(event.data.data);
      } else {
        const motion = event.data;
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

    worker.addEventListener('message', receiveSnapshot);
    worker.postMessage({ type: 'initialize', scenarioId } satisfies SimulationCommand);

    return () => {
      worker.removeEventListener('message', receiveSnapshot);
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
