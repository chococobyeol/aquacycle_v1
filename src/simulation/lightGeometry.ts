import { TANK_WIDTH, WATER_TOP } from './types';

// Shared by the light simulation and the world-space fixture drawing so the
// visible lamp never disagrees with the source used by the light field.
export const FIXED_LAMP_X = TANK_WIDTH * 0.34;
// The source is physically above the tank-local y=0 rim. Rendering and light
// rays now share this genuinely exterior coordinate instead of borrowing the
// tank's internal headspace.
export const FIXED_LAMP_Y = -34;
export const FIXED_LAMP_WIDTH = 175;
