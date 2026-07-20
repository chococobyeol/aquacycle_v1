import { describe, expect, it } from 'vitest';
import { STRUCTURES } from '../src/simulation/config';
import {
  pointInPolygon,
  sampleEcologyFace,
  sampleSubstrate,
  transformLocalPoint,
} from '../src/simulation/surfaces';

describe('two-dimensional ecology faces', () => {
  it('fills the visible rock face instead of sampling only its top edge', () => {
    const definition = STRUCTURES['flat-stone'];
    const samples = sampleEcologyFace(definition);
    expect(samples.length).toBeGreaterThan(150);
    expect(new Set(samples.map((sample) => sample.row)).size).toBeGreaterThan(5);
    expect(samples.every((sample) => pointInPolygon(sample, definition.ecologyPolygon))).toBe(true);
    expect(samples.some((sample) => sample.neighborIndices.length >= 5)).toBe(true);
  });

  it('moves every ecology cell with the same structure transform', () => {
    const point = transformLocalPoint({ x: 10, y: 0 }, { x: 100, y: 80 }, Math.PI / 2);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(90);
  });

  it('provides a connected substrate growth band', () => {
    const substrate = sampleSubstrate();
    expect(substrate.length).toBeGreaterThan(300);
    expect(substrate.every((cell) => cell.neighborIndices.length >= 3)).toBe(true);
  });
});
