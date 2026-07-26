export interface ObservationScrollPosition {
  identity: string | null;
  requestedTop: number;
}

export interface ObservationScrollIntent {
  pointerActive: boolean;
  intentUntil: number;
}

export const createObservationScrollPosition = (): ObservationScrollPosition => ({
  identity: null,
  requestedTop: 0,
});

/**
 * A tab or selected-target change starts at the top. Live simulation updates
 * keep the same identity, so they must not rewrite the player's scroll
 * position.
 */
export const prepareObservationScrollIdentity = (
  position: ObservationScrollPosition,
  identity: string,
): void => {
  if (position.identity === identity) return;
  position.identity = identity;
  position.requestedTop = 0;
};

/** Only direct user scrolling is allowed to change the remembered position. */
export const rememberObservationUserScroll = (
  position: ObservationScrollPosition,
  identity: string,
  scrollTop: number,
): void => {
  prepareObservationScrollIdentity(position, identity);
  position.requestedTop = Math.max(0, scrollTop);
};

export const observationScrollIsUserDriven = (
  intent: ObservationScrollIntent,
  now: number,
): boolean => intent.pointerActive || now <= intent.intentUntil;

/**
 * The live notebook gains and loses rows as populations change. Clamp only the
 * DOM target while it is temporarily short; retain requestedTop so a later
 * growth does not silently move the player to a different part of the record.
 */
export const observationScrollTarget = (
  position: ObservationScrollPosition,
  identity: string,
  scrollHeight: number,
  clientHeight: number,
): number => {
  prepareObservationScrollIdentity(position, identity);
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return Math.min(position.requestedTop, maximum);
};
