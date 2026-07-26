import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'vitest' },
    configurable: true,
  });
});

import { animalFeedingStateText } from '../src/renderer/ui/SimulationScreen';

describe('animal inspector feeding status', () => {
  it('shows an immediate Daphnia meal without a biomass threshold', () => {
    expect(animalFeedingStateText(0, '식물플랑크톤'))
      .toBe('지금 섭식 중 · 식물플랑크톤');
    expect(animalFeedingStateText(8, '부유 분해균'))
      .toBe('방금 섭식 · 부유 분해균');
  });

  it('uses elapsed feeding time and eventually expires the recent label', () => {
    expect(animalFeedingStateText(31.4, '식물플랑크톤'))
      .toBe('31초 전 섭식');
    expect(animalFeedingStateText(60, '식물플랑크톤'))
      .toBe('최근 먹지 않음');
    expect(animalFeedingStateText(Number.POSITIVE_INFINITY, null))
      .toBe('최근 먹지 않음');
  });
});
