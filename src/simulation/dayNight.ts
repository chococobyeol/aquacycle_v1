export type DayNightPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface DayNightCycleDefinition {
  dawnSeconds: number;
  daySeconds: number;
  duskSeconds: number;
  nightSeconds: number;
  nightLightMultiplier: number;
  startingOffsetSeconds: number;
}

export interface DayNightState {
  phase: DayNightPhase;
  phaseProgress: number;
  cycleProgress: number;
  cycleIndex: number;
  lightMultiplier: number;
  secondsUntilTransition: number;
  cycleDurationSeconds: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};

export const DAYLIGHT_DAY_EDGE_ANGLE_RADIANS = 20 * Math.PI / 180;
export const DAYLIGHT_HORIZON_ANGLE_RADIANS = 45 * Math.PI / 180;

/**
 * Direction of the direct daylight bundle, measured from vertical.
 *
 * Positive angles travel down and to the right. The unwrapped angle always
 * decreases: sunrise enters from one side, crosses vertical at noon, leaves
 * from the other side, and continues below the horizon during the night.
 * The below-horizon direction is not used as direct light; retaining it keeps
 * the authored orbit continuous instead of teleporting the sun back overhead.
 */
export const daylightAngleRadians = (
  state: DayNightState | null,
): number => {
  if (!state) return 0;
  const progress = state.phaseProgress;
  if (state.phase === 'dawn') {
    return DAYLIGHT_HORIZON_ANGLE_RADIANS +
      (
        DAYLIGHT_DAY_EDGE_ANGLE_RADIANS -
          DAYLIGHT_HORIZON_ANGLE_RADIANS
      ) * progress;
  }
  if (state.phase === 'day') {
    return DAYLIGHT_DAY_EDGE_ANGLE_RADIANS *
      (1 - 2 * progress);
  }
  if (state.phase === 'dusk') {
    return -DAYLIGHT_DAY_EDGE_ANGLE_RADIANS +
      (
        -DAYLIGHT_HORIZON_ANGLE_RADIANS +
          DAYLIGHT_DAY_EDGE_ANGLE_RADIANS
      ) * progress;
  }
  // End at -315°, which is the same direction as the next dawn's +45°.
  return -DAYLIGHT_HORIZON_ANGLE_RADIANS -
    (Math.PI * 2 - DAYLIGHT_HORIZON_ANGLE_RADIANS * 2) * progress;
};

export const dayNightCycleDuration = (cycle: DayNightCycleDefinition): number =>
  Math.max(1, cycle.dawnSeconds + cycle.daySeconds + cycle.duskSeconds + cycle.nightSeconds);

export const dayNightStateAt = (
  elapsedSeconds: number,
  cycle: DayNightCycleDefinition,
): DayNightState => {
  const cycleDurationSeconds = dayNightCycleDuration(cycle);
  const absoluteTime = Math.max(0, elapsedSeconds) + Math.max(0, cycle.startingOffsetSeconds);
  const cycleIndex = Math.floor(absoluteTime / cycleDurationSeconds);
  const timeInCycle = absoluteTime % cycleDurationSeconds;
  const nightLight = clamp01(cycle.nightLightMultiplier);
  const dawnEnd = cycle.dawnSeconds;
  const dayEnd = dawnEnd + cycle.daySeconds;
  const duskEnd = dayEnd + cycle.duskSeconds;

  let phase: DayNightPhase;
  let phaseProgress: number;
  let lightMultiplier: number;
  let secondsUntilTransition: number;
  if (timeInCycle < dawnEnd) {
    phase = 'dawn';
    phaseProgress = dawnEnd > 0 ? timeInCycle / dawnEnd : 1;
    lightMultiplier = nightLight + (1 - nightLight) * smoothstep(phaseProgress);
    secondsUntilTransition = dawnEnd - timeInCycle;
  } else if (timeInCycle < dayEnd) {
    phase = 'day';
    phaseProgress = cycle.daySeconds > 0 ? (timeInCycle - dawnEnd) / cycle.daySeconds : 1;
    lightMultiplier = 1;
    secondsUntilTransition = dayEnd - timeInCycle;
  } else if (timeInCycle < duskEnd) {
    phase = 'dusk';
    phaseProgress = cycle.duskSeconds > 0 ? (timeInCycle - dayEnd) / cycle.duskSeconds : 1;
    lightMultiplier = 1 - (1 - nightLight) * smoothstep(phaseProgress);
    secondsUntilTransition = duskEnd - timeInCycle;
  } else {
    phase = 'night';
    phaseProgress = cycle.nightSeconds > 0 ? (timeInCycle - duskEnd) / cycle.nightSeconds : 1;
    lightMultiplier = nightLight;
    secondsUntilTransition = cycleDurationSeconds - timeInCycle;
  }

  return {
    phase,
    phaseProgress: clamp01(phaseProgress),
    cycleProgress: timeInCycle / cycleDurationSeconds,
    cycleIndex,
    lightMultiplier,
    secondsUntilTransition: Math.max(0, secondsUntilTransition),
    cycleDurationSeconds,
  };
};
