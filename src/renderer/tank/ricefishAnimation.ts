export interface RicefishSwimPose {
  bodySkewY: number;
  tailSkewY: number;
  pectoralRotation: number;
  dorsalRotation: number;
  analRotation: number;
}

export interface RicefishStrikePose {
  bodyRotation: number;
  bodySkewY: number;
  tailSkewY: number;
}

// The generic animal phase was tuned for visible shrimp leg movement and is
// far too slow for a continuously undulating medaka. At 1x this maps the
// existing traveling profile to about 4 complete left-right beats per second.
// Published 6–9 Hz values count half-beats; treating those as full cycles made
// the first revision too fast.
export const RICEFISH_SWIM_RATE_MULTIPLIER = 3.4;
export const RICEFISH_BITE_DURATION_SECONDS = 0.18;

export const ricefishConsumedFood = (
  previousConsumedBiomass: number,
  nextConsumedBiomass: number,
): boolean => Number.isFinite(previousConsumedBiomass) &&
  Number.isFinite(nextConsumedBiomass) &&
  nextConsumedBiomass > previousConsumedBiomass + 1e-9;

/**
 * Converts a countdown pulse (1 -> 0) into a fast-open, slower-close gape.
 * Peak gape occurs one quarter of the way through the 180 ms bite.
 */
export const ricefishMouthGape = (pulse: number): number => {
  if (!Number.isFinite(pulse) || pulse <= 0) return 0;
  const progress = 1 - Math.max(0, Math.min(1, pulse));
  if (progress < 0.25) {
    return Math.sin(progress / 0.25 * Math.PI * 0.5);
  }
  return Math.cos((progress - 0.25) / 0.75 * Math.PI * 0.5);
};

/**
 * A brief S-bend and lateral sweep over the same 180 ms as a visible bite.
 *
 * The aquarium is drawn from the side, so depth-axis side-swing motion is
 * represented by a small whole-body yaw plus opposing trunk/tail flex. The
 * envelope returns exactly to the ordinary swim pose at both ends.
 */
export const ricefishSideSwingPose = (
  pulse: number,
  side: -1 | 1,
): RicefishStrikePose => {
  const boundedPulse = Math.max(0, Math.min(1, pulse));
  const progress = 1 - boundedPulse;
  const envelope = Math.sin(progress * Math.PI);
  const recoil = Math.sin(progress * Math.PI * 2) * 0.22;
  return {
    bodyRotation: side * envelope * 0.035,
    bodySkewY: side * envelope * 0.075,
    tailSkewY: side * (recoil - envelope * 0.34),
  };
};

/**
 * A compact two-joint body wave. The front third is the visual anchor, the
 * rear body shears gently around it, and the caudal fin receives a much
 * larger delayed shear. A small second harmonic prevents the motion from
 * reading like a perfectly reversible metronome.
 */
export const ricefishSwimPose = (
  phase: number,
  bend: number,
): RicefishSwimPose => {
  const amplitude = Math.max(0, Math.min(0.16, bend));
  const secondHarmonic = Math.sin(phase * 2 - 0.45);
  const medianFinWave = Math.sin(phase - 0.32) + secondHarmonic * 0.08;
  return {
    bodySkewY:
      -(Math.sin(phase - 0.55) + secondHarmonic * 0.1) * amplitude * 0.22,
    tailSkewY:
      (Math.sin(phase) + secondHarmonic * 0.14) * amplitude * 3,
    // The pectoral fin only makes a small, quick stabilizing flick in side
    // view. Fin area never changes; large slow sweeps read like an oar.
    pectoralRotation:
      Math.sin(phase * 0.82 + 0.7) * (0.012 + amplitude * 0.2),
    // Dorsal and anal fins are active stabilizers, but they do not row like
    // the tail during straight swimming. Their membranes flex by roughly one
    // degree around roots that remain buried under the body contour.
    dorsalRotation: medianFinWave * (0.005 + amplitude * 0.12),
    analRotation: -medianFinWave * (0.006 + amplitude * 0.14),
  };
};
