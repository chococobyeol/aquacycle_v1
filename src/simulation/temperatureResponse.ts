export interface TemperatureResponsePoint {
  temperature: number;
  response: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Piecewise-linear thermal performance curve. Curves live in the species or
 * guild definition so adding another organism does not require another set of
 * temperature conditionals in SimulationWorld.
 */
export const interpolateTemperatureResponse = (
  curve: readonly TemperatureResponsePoint[],
  temperature: number,
): number => {
  if (!curve.length || !Number.isFinite(temperature)) return 0;
  if (temperature <= curve[0].temperature) return curve[0].response;
  if (temperature >= curve.at(-1)!.temperature) return curve.at(-1)!.response;
  for (let index = 0; index < curve.length - 1; index += 1) {
    const start = curve[index];
    const end = curve[index + 1];
    if (temperature > end.temperature) continue;
    const ratio = (temperature - start.temperature) /
      (end.temperature - start.temperature);
    return start.response + (end.response - start.response) * ratio;
  }
  return 0;
};

/**
 * EPA/WASP-style theta correction: k(T) = k(ref) * theta^(T-ref).
 * The cap is a gameplay safety rail for extreme/corrupt temperatures, not a
 * claim that biological rates keep rising indefinitely.
 */
export const thetaTemperatureFactor = (
  temperature: number,
  referenceTemperature: number,
  theta: number,
  minimumFactor = 0.2,
  maximumFactor = 2.5,
): number => clamp(
  Math.pow(theta, temperature - referenceTemperature),
  minimumFactor,
  maximumFactor,
);
