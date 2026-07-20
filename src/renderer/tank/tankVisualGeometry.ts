import {
  FIXED_LAMP_WIDTH,
  FIXED_LAMP_X,
  FIXED_LAMP_Y,
} from '../../simulation/lightGeometry';
import { TANK_HEIGHT, TANK_WIDTH, WATER_TOP } from '../../simulation/types';

// The tank keeps its complete local 1200 × 720 bounds. Exterior room space is
// a sibling in the wider camera composition, never borrowed from the tank.
export const TANK_GLASS_LEFT = 7;
export const TANK_GLASS_TOP = 7;
export const TANK_GLASS_RIGHT = TANK_WIDTH - 7;
export const TANK_GLASS_BOTTOM = TANK_HEIGHT - 7;
export const TANK_FRAME_STROKE_WIDTH = 10;
export const TANK_VISUAL_WATER_TOP = WATER_TOP;

// Exterior room is needed above the glass for the lamp, but not beside it.
// At 100% the aquarium can therefore reach both viewport edges; the fitted
// view still reveals the complete lamp and all four tank edges.
export const CAMERA_SCENE_LEFT = 0;
export const CAMERA_SCENE_RIGHT = TANK_WIDTH;
export const CAMERA_SCENE_TOP = -72;
export const CAMERA_SCENE_BOTTOM = TANK_HEIGHT;
export const CAMERA_SCENE_WIDTH = CAMERA_SCENE_RIGHT - CAMERA_SCENE_LEFT;
export const CAMERA_SCENE_HEIGHT = CAMERA_SCENE_BOTTOM - CAMERA_SCENE_TOP;
export const CAMERA_SCENE_CENTER_X = (CAMERA_SCENE_LEFT + CAMERA_SCENE_RIGHT) / 2;
export const CAMERA_SCENE_CENTER_Y = (CAMERA_SCENE_TOP + CAMERA_SCENE_BOTTOM) / 2;

// The housing extends beyond the emitter. The bright strip itself is exactly
// the line used by the light simulation.
export const LAMP_FIXTURE_WIDTH = FIXED_LAMP_WIDTH + 16;
export const LAMP_FIXTURE_LEFT = FIXED_LAMP_X - LAMP_FIXTURE_WIDTH / 2;
export const LAMP_FIXTURE_HEIGHT = 18;
export const LAMP_FIXTURE_TOP = FIXED_LAMP_Y - LAMP_FIXTURE_HEIGHT + 3;
export const LAMP_FIXTURE_BOTTOM = LAMP_FIXTURE_TOP + LAMP_FIXTURE_HEIGHT;
export const LAMP_GLOW_WIDTH = FIXED_LAMP_WIDTH;
export const LAMP_GLOW_LEFT = FIXED_LAMP_X - LAMP_GLOW_WIDTH / 2;
export const LAMP_GLOW_HEIGHT = 5;
export const LAMP_GLOW_TOP = FIXED_LAMP_Y - LAMP_GLOW_HEIGHT / 2;
export const LAMP_GLOW_BOTTOM = LAMP_GLOW_TOP + LAMP_GLOW_HEIGHT;
export const LAMP_CABLE_TOP = CAMERA_SCENE_TOP + 4;
