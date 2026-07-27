import inspector from 'node:inspector';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  createSharedTelemetryChannel,
  SharedTelemetryWriter,
} from '../src/simulation/sharedTelemetry';
import { applyMission7AcceptanceFixture } from './mission7AcceptanceMatrix';
import type { SimulationSnapshot, WorkerSnapshotMessage } from '../src/simulation/types';

const session = new inspector.Session();
session.connect();
const post = (
  method: string,
  params?: Record<string, unknown>,
) => new Promise<Record<string, unknown>>((resolve, reject) => {
  session.post(method, params ?? {}, (error, result) => {
    if (error) reject(error);
    else resolve(result as Record<string, unknown>);
  });
});

const world = new SimulationWorld('mission-7');
applyMission7AcceptanceFixture(world, 'full-stock-stress');
world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

const writer = new SharedTelemetryWriter(createSharedTelemetryChannel());
let reusableSnapshot: SimulationSnapshot | undefined;
for (let tick = 0; tick < 20; tick += 1) {
  if (world.tick(0.1) && tick % 10 === 0) {
    reusableSnapshot = world.snapshot(reusableSnapshot);
  }
}

await post('HeapProfiler.enable');
await post('HeapProfiler.startSampling', {
  samplingInterval: 65_536,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});

const ticks = Number(process.env.PROFILE_TICKS ?? 1_200);
for (let tick = 0; tick < ticks; tick += 1) {
  if (world.tick(0.1) && tick % 10 === 0) {
    reusableSnapshot = world.snapshot(reusableSnapshot);
    const message: WorkerSnapshotMessage = {
      type: 'snapshot',
      snapshot: reusableSnapshot,
    };
    writer.publish(message);
  }
}

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children?: SamplingNode[];
}

const result = await post('HeapProfiler.stopSampling') as unknown as {
  profile: { head: SamplingNode };
};

const allocations: Array<{
  functionName: string;
  url: string;
  lineNumber: number;
  selfSize: number;
}> = [];
const visit = (node: SamplingNode): void => {
  if (node.selfSize > 0) {
    allocations.push({
      ...node.callFrame,
      selfSize: node.selfSize,
    });
  }
  for (const child of node.children ?? []) visit(child);
};
visit(result.profile.head);
allocations.sort((left, right) => right.selfSize - left.selfSize);

console.log(JSON.stringify({
  elapsedSeconds: world.snapshot().elapsedSeconds,
  memory: process.memoryUsage(),
  allocations: allocations.slice(0, 40),
}, null, 2));
session.disconnect();
