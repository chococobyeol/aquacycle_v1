import { describe, expect, it } from 'vitest';
import { observationSelectionIdentity } from '../src/renderer/ui/observationSelection';
import type { SelectionSnapshot } from '../src/simulation/types';

describe('observation selection identity', () => {
  it('does not treat live coordinate updates as a new selected animal', () => {
    const first: SelectionSnapshot = {
      kind: 'animal',
      x: 120,
      y: 300,
      ownerLabel: '체리새우',
      animalId: 'animal-4',
    };
    const moved = { ...first, x: 760, y: 480 };

    expect(observationSelectionIdentity(moved)).toBe(
      observationSelectionIdentity(first),
    );
  });

  it('keeps a selected surface stable when its living contents change', () => {
    const plant: SelectionSnapshot = {
      kind: 'colony',
      x: 420,
      y: 600,
      ownerLabel: '나사말 포기',
      cellId: 'substrate-cell-12',
      plantId: 'seed-8',
      speciesId: 'vallisneria',
      speciesIds: ['vallisneria'],
    };
    const replaced: SelectionSnapshot = {
      ...plant,
      ownerLabel: '바닥재 표면',
      plantId: undefined,
      speciesId: 'nitzschia',
      speciesIds: ['nitzschia'],
    };

    expect(observationSelectionIdentity(replaced)).toBe(
      observationSelectionIdentity(plant),
    );
    expect(observationSelectionIdentity({ ...replaced, x: 500 })).toBe(
      observationSelectionIdentity(replaced),
    );
  });
});
