import type { SelectionSnapshot } from '../../simulation/types';

const sortedIdentity = (values: string[] | undefined): string =>
  [...(values ?? [])].sort().join(',');

/**
 * Identifies what the player selected without including live values such as
 * an animal's moving coordinates or a colony's changing species metadata.
 * Those values may refresh every simulation snapshot, but must not pull an
 * explicitly selected "tank overview" tab back to "selected target".
 */
export const observationSelectionIdentity = (
  selection: SelectionSnapshot | null,
): string | null => {
  if (!selection) return null;
  switch (selection.kind) {
    case 'structure':
      return `structure:${selection.structureId ?? 'unknown'}`;
    case 'colony':
      return `colony:${selection.cellId ?? selection.plantId ?? 'unknown'}`;
    case 'animal':
      return `animal:${selection.animalId ?? 'unknown'}`;
    case 'carcass':
      return `carcass:${selection.carcassId ?? 'unknown'}`;
    case 'measurement':
      return `measurement:${selection.measurementId ?? 'unknown'}`;
    case 'region':
      return [
        'region',
        sortedIdentity(selection.structureIds),
        sortedIdentity(selection.measurementIds),
        sortedIdentity(selection.animalIds),
        sortedIdentity(selection.cellIds),
        selection.bounds
          ? `${selection.bounds.minX},${selection.bounds.minY},${selection.bounds.maxX},${selection.bounds.maxY}`
          : '',
      ].join(':');
  }
};
