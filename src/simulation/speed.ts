export const SIMULATION_SPEED_OPTIONS = [1, 2, 4, 8, 16, 32, 64] as const;

export type SimulationSpeed = (typeof SIMULATION_SPEED_OPTIONS)[number];

export const DEFAULT_SIMULATION_SPEED: SimulationSpeed = 1;
export const MAX_SIMULATION_SPEED: SimulationSpeed =
  SIMULATION_SPEED_OPTIONS[SIMULATION_SPEED_OPTIONS.length - 1];

/**
 * Commands normally come from the speed picker, but the worker boundary is a
 * runtime boundary. Keep an unexpected value from leaving the picker without
 * a matching option by snapping it to the nearest supported speed.
 */
export const normalizeSimulationSpeed = (value: number): SimulationSpeed => {
  if (!Number.isFinite(value)) return DEFAULT_SIMULATION_SPEED;

  return SIMULATION_SPEED_OPTIONS.reduce<SimulationSpeed>((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest,
  DEFAULT_SIMULATION_SPEED);
};
