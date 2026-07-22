import type { StructureSnapshot } from '../../simulation/types';

export interface StructureEditCameraTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface StructureEditOverlayLayout {
  left: number;
  top: number;
  rotateLeftX: number;
  rotateRightX: number;
  deleteY: number;
}

type StructureEditMotion = Pick<StructureSnapshot, 'x' | 'y' | 'angle'>;

/**
 * Shared motion packets intentionally omit static structure metadata such as
 * dimensions. Keep that metadata from the full snapshot while applying only
 * the high-frequency transform, otherwise the action spacing collapses to the
 * centre as soon as a structure starts moving.
 */
export const structureEditOverlaySnapshot = (
  structure: StructureSnapshot,
  motion: StructureEditMotion | null | undefined,
): StructureSnapshot => motion ? {
  ...structure,
  x: motion.x,
  y: motion.y,
  angle: motion.angle,
} : structure;

const ACTION_INSET = 28;
const ACTION_GAP = 52;

/**
 * Keeps the move handle on the exact rendered centre of the structure. The
 * other actions move around that fixed centre and may flip above the object
 * near the substrate, rather than shifting the whole control group away from
 * the object it edits.
 */
export const structureEditOverlayLayout = (
  structure: StructureSnapshot,
  camera: StructureEditCameraTransform,
): StructureEditOverlayLayout => {
  const cosine = Math.cos(structure.angle);
  const sine = Math.sin(structure.angle);
  const screenWidth = (
    Math.abs(structure.width * cosine) +
    Math.abs(structure.height * sine)
  ) * camera.scale;
  const screenHeight = (
    Math.abs(structure.height * cosine) +
    Math.abs(structure.width * sine)
  ) * camera.scale;
  const left = camera.offsetX + structure.x * camera.scale;
  const top = camera.offsetY + structure.y * camera.scale;
  const desiredHorizontal = screenWidth / 2 + ACTION_GAP;
  const desiredVertical = screenHeight / 2 + ACTION_GAP;
  const availableLeft = Math.max(0, left - ACTION_INSET);
  const availableRight = Math.max(0, camera.viewportWidth - ACTION_INSET - left);
  const availableAbove = Math.max(0, top - ACTION_INSET);
  const availableBelow = Math.max(0, camera.viewportHeight - ACTION_INSET - top);
  const placeDeleteBelow = availableBelow >= desiredVertical || availableBelow >= availableAbove;

  return {
    left,
    top,
    rotateLeftX: -Math.min(desiredHorizontal, availableLeft),
    rotateRightX: Math.min(desiredHorizontal, availableRight),
    deleteY: placeDeleteBelow
      ? Math.min(desiredVertical, availableBelow)
      : -Math.min(desiredVertical, availableAbove),
  };
};
