const REFERENCE_TEMPERATURE_C = 24;

/**
 * Benson-Krause freshwater oxygen solubility at one atmosphere and zero
 * salinity, in mg/L. This is USGS Technical Memorandum 2011.03 equation 7.
 * The published equation is valid from 0 to 40°C, so inputs are bounded to
 * that interval before evaluation.
 */
export const freshwaterOxygenSolubilityMgL = (temperatureC: number): number => {
  const bounded = Math.max(0, Math.min(40, temperatureC));
  const kelvin = bounded + 273.15;
  return Math.exp(
    -139.34411 +
    1.575701e5 / kelvin -
    6.642308e7 / kelvin ** 2 +
    1.2438e10 / kelvin ** 3 -
    8.621949e11 / kelvin ** 4,
  );
};

const REFERENCE_OXYGEN_SOLUBILITY = freshwaterOxygenSolubilityMgL(
  REFERENCE_TEMPERATURE_C,
);

/** Relative water-side capacity used by the compressed closed-headspace tank. */
export const relativeOxygenSolubility = (temperatureC: number): number =>
  freshwaterOxygenSolubilityMgL(temperatureC) / REFERENCE_OXYGEN_SOLUBILITY;

/**
 * Conservatively partitions the game's finite oxygen store. At 24°C the old
 * 1:1 water/headspace equilibrium is preserved; colder water receives a
 * larger share and warmer water a smaller share.
 */
export const closedOxygenWaterEquilibrium = (
  totalOxygen: number,
  surfaceTemperatureC: number,
): number => {
  const capacity = relativeOxygenSolubility(surfaceTemperatureC);
  return Math.max(0, totalOxygen) * capacity / (1 + capacity);
};
