import { describe, expect, it } from 'vitest';
import {
  FIXED_LAMP_WIDTH,
  FIXED_LAMP_X,
  FIXED_LAMP_Y,
} from '../src/simulation/lightGeometry';
import {
  CAMERA_SCENE_BOTTOM,
  CAMERA_SCENE_HEIGHT,
  CAMERA_SCENE_TOP,
  LAMP_CABLE_TOP,
  LAMP_FIXTURE_BOTTOM,
  LAMP_FIXTURE_LEFT,
  LAMP_FIXTURE_TOP,
  LAMP_FIXTURE_WIDTH,
  LAMP_GLOW_BOTTOM,
  LAMP_GLOW_LEFT,
  LAMP_GLOW_TOP,
  LAMP_GLOW_WIDTH,
  TANK_FRAME_STROKE_WIDTH,
  TANK_GLASS_TOP,
  TANK_VISUAL_WATER_TOP,
} from '../src/renderer/tank/tankVisualGeometry';

describe('tank visual geometry', () => {
  it('keeps the visible lamp aligned with the simulated fixed light source', () => {
    expect(LAMP_FIXTURE_LEFT + LAMP_FIXTURE_WIDTH / 2).toBe(FIXED_LAMP_X);
    expect(LAMP_FIXTURE_WIDTH).toBeGreaterThan(FIXED_LAMP_WIDTH);
    expect(LAMP_GLOW_LEFT + LAMP_GLOW_WIDTH / 2).toBe(FIXED_LAMP_X);
    expect(LAMP_GLOW_WIDTH).toBe(FIXED_LAMP_WIDTH);
    expect((LAMP_GLOW_TOP + LAMP_GLOW_BOTTOM) / 2).toBe(FIXED_LAMP_Y);
    expect(LAMP_GLOW_TOP).toBeGreaterThanOrEqual(LAMP_FIXTURE_TOP);
    expect(LAMP_GLOW_BOTTOM).toBeLessThanOrEqual(LAMP_FIXTURE_BOTTOM);
  });

  it('keeps every visible part of the lamp outside the aquarium glass', () => {
    const topOfFrameInk = TANK_GLASS_TOP - TANK_FRAME_STROKE_WIDTH / 2;
    const bottomOfFrameInk = TANK_GLASS_TOP + TANK_FRAME_STROKE_WIDTH / 2;
    expect(LAMP_GLOW_BOTTOM).toBeLessThan(topOfFrameInk);
    expect(bottomOfFrameInk).toBeLessThan(TANK_VISUAL_WATER_TOP);
    expect(TANK_VISUAL_WATER_TOP - bottomOfFrameInk).toBeGreaterThanOrEqual(20);
    expect(LAMP_GLOW_BOTTOM).toBeLessThan(0);
    expect(LAMP_CABLE_TOP).toBeGreaterThanOrEqual(CAMERA_SCENE_TOP);
    expect(CAMERA_SCENE_BOTTOM - CAMERA_SCENE_TOP).toBe(CAMERA_SCENE_HEIGHT);
  });
});
