import { describe, expect, it } from 'vitest';
import {
  createObservationScrollPosition,
  observationScrollIsUserDriven,
  observationScrollTarget,
  prepareObservationScrollIdentity,
  rememberObservationUserScroll,
} from '../src/renderer/ui/observationScrollPosition';

describe('observation notebook scroll position', () => {
  it('keeps the player-owned position across live content updates', () => {
    const position = createObservationScrollPosition();
    rememberObservationUserScroll(position, 'overview', 420);

    expect(observationScrollTarget(position, 'overview', 1_400, 600)).toBe(420);
    expect(observationScrollTarget(position, 'overview', 1_520, 600)).toBe(420);
    expect(position.requestedTop).toBe(420);
  });

  it('does not forget the requested position when live rows temporarily shrink', () => {
    const position = createObservationScrollPosition();
    rememberObservationUserScroll(position, 'overview', 720);

    expect(observationScrollTarget(position, 'overview', 900, 600)).toBe(300);
    expect(position.requestedTop).toBe(720);
    expect(observationScrollTarget(position, 'overview', 1_500, 600)).toBe(720);
  });

  it('starts a different observation view or selection at the top', () => {
    const position = createObservationScrollPosition();
    rememberObservationUserScroll(position, 'overview', 360);

    prepareObservationScrollIdentity(position, 'selection:animal-3');

    expect(position.identity).toBe('selection:animal-3');
    expect(position.requestedTop).toBe(0);
    expect(observationScrollTarget(
      position,
      'selection:animal-3',
      1_200,
      600,
    )).toBe(0);
  });

  it('distinguishes direct user scrolling from browser layout scrolling', () => {
    expect(observationScrollIsUserDriven({
      pointerActive: false,
      intentUntil: 0,
    }, 500)).toBe(false);
    expect(observationScrollIsUserDriven({
      pointerActive: false,
      intentUntil: 620,
    }, 500)).toBe(true);
    expect(observationScrollIsUserDriven({
      pointerActive: true,
      intentUntil: 0,
    }, 500)).toBe(true);
  });
});
