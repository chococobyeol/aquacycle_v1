export const MEMORY_RECOVERY_MINIMUM_MB = 900;
export const MEMORY_RECOVERY_MAXIMUM_MB = 1_400;
export const MEMORY_RECOVERY_HARD_LIMIT_MB = 1_800;
export const MEMORY_RECOVERY_REQUIRED_GROWTH_MB = 512;
export const MEMORY_RECOVERY_COOLDOWN_MS = 5 * 60_000;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const rendererMemoryRecoveryThresholdMb = (
  totalSystemMemoryBytes: number,
): number => clamp(
  totalSystemMemoryBytes / (1024 * 1024) * 0.075,
  MEMORY_RECOVERY_MINIMUM_MB,
  MEMORY_RECOVERY_MAXIMUM_MB,
);

export interface RendererMemoryGuardState {
  minimumPrivateMb: number;
  recentPrivateMb: number[];
}

export const createRendererMemoryGuardState = (): RendererMemoryGuardState => ({
  minimumPrivateMb: Number.POSITIVE_INFINITY,
  recentPrivateMb: [],
});

export interface RendererMemoryGuardDecision {
  shouldRecover: boolean;
  thresholdMb: number;
  growthMb: number;
  rising: boolean;
}

export const evaluateRendererMemoryGuard = (
  state: RendererMemoryGuardState,
  privateMb: number,
  totalSystemMemoryBytes: number,
  recoveryAllowed: boolean,
): RendererMemoryGuardDecision => {
  if (!Number.isFinite(privateMb) || privateMb <= 0) {
    return {
      shouldRecover: false,
      thresholdMb: rendererMemoryRecoveryThresholdMb(totalSystemMemoryBytes),
      growthMb: 0,
      rising: false,
    };
  }

  state.minimumPrivateMb = Math.min(state.minimumPrivateMb, privateMb);
  state.recentPrivateMb.push(privateMb);
  if (state.recentPrivateMb.length > 4) state.recentPrivateMb.shift();

  const thresholdMb = rendererMemoryRecoveryThresholdMb(totalSystemMemoryBytes);
  const growthMb = privateMb - state.minimumPrivateMb;
  const recent = state.recentPrivateMb;
  let risingSteps = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index] > recent[index - 1] + 4) risingSteps += 1;
  }
  const rising = recent.length >= 4 &&
    risingSteps >= 2 &&
    recent[recent.length - 1] - recent[0] >= 64;
  const hardLimitReached = privateMb >= MEMORY_RECOVERY_HARD_LIMIT_MB;
  const sustainedLeakReached =
    privateMb >= thresholdMb &&
    growthMb >= MEMORY_RECOVERY_REQUIRED_GROWTH_MB &&
    rising;

  return {
    shouldRecover: recoveryAllowed && (hardLimitReached || sustainedLeakReached),
    thresholdMb,
    growthMb,
    rising,
  };
};
