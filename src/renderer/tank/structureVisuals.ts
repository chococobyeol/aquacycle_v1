// Kept as a compatibility export for renderer callers outside this module.
// The source of truth now lives beside the simulation so physics-facing ecology
// coordinates and visuals cannot drift to different authored origins.
export { structureVisualOffset } from '../../simulation/structureGeometry';
