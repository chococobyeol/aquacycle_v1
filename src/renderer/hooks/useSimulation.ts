import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HoldingSnapshot,
  ProbeSnapshot,
  ScenarioId,
  SimulationCommand,
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
  clear: () => void;
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
  const listeners = new Set<() => void>();

  return {
    getFrames: () => frames,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accept: (message, receivedAtMs) => {
      if (frames.current && message.sequence <= frames.current.sequence) return false;
      const { type: _type, ...sample } = message;
      const current: SimulationMotionFrame = { ...sample, receivedAtMs };
      frames = { previous: frames.current, current };
      for (const listener of [...listeners]) listener();
      return true;
    },
    clear: () => {
      if (!frames.current && !frames.previous) return;
      frames = EMPTY_MOTION_FRAMES;
      for (const listener of [...listeners]) listener();
    },
  };
};

export interface SimulationController {
  snapshot: SimulationSnapshot | null;
  motionSource: SimulationMotionSource;
  send: (command: SimulationCommand) => void;
}

const commandRebasesMotion = (command: SimulationCommand): boolean => {
  switch (command.type) {
    case 'initialize':
    case 'reset':
    case 'start':
    case 'pause':
    case 'resume':
    case 'set-speed':
    case 'pick-structure':
    case 'pick-seed':
    case 'pick-animal':
    case 'pick-at':
    case 'drop-held':
    case 'cancel-held':
    case 'retrieve-held':
    case 'rotate-held':
    case 'remove-held-structure':
    case 'retrieve-structure':
    case 'retrieve-animal':
      return true;
    default:
      return false;
  }
};

export const useSimulation = (scenarioId: ScenarioId): SimulationController => {
  const workerRef = useRef<Worker | null>(null);
  const [motionStore] = useState(createSimulationMotionStore);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../../simulation/sim.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    motionStore.clear();

    const receiveSnapshot = (event: MessageEvent<WorkerMessage>): void => {
      if (event.data.type === 'snapshot') {
        if (event.data.snapshot.scenarioId !== scenarioId) return;
        setSnapshot(event.data.snapshot);
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
      motionStore.clear();
    };
  }, [motionStore, scenarioId]);

  const send = useCallback((command: SimulationCommand): void => {
    // Topology, phase, or integration-speed changes begin a fresh interpolation
    // window. Replaying the last 64x sample after switching to 1x caused the
    // renderer to chase a stale target even though the worker was already stable.
    if (commandRebasesMotion(command)) motionStore.clear();
    workerRef.current?.postMessage(command);
  }, [motionStore]);

  return { snapshot, motionSource: motionStore, send };
};
