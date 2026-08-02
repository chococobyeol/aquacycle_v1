import type { TankTypeId } from '../../simulation/types';

const LABORATORY_TANK_KEY = 'aquacycle:laboratory-tank:v1';

export const readLaboratoryTankPreference = (): TankTypeId => {
  try {
    return window.localStorage.getItem(LABORATORY_TANK_KEY) === 'long'
      ? 'long'
      : 'standard';
  } catch {
    return 'standard';
  }
};

export const writeLaboratoryTankPreference = (tankType: TankTypeId): void => {
  try {
    window.localStorage.setItem(LABORATORY_TANK_KEY, tankType);
  } catch {
    // The simulation still switches tanks when storage is unavailable.
  }
};
