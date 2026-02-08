// Arc-slot math for virtual carousel — pure functions

export const ARC_STEP = 26;       // degrees between adjacent cards
export const POOL_HALF = 4;       // cards on each side of center
export const POOL_SIZE = 9;       // total card pool (2 * POOL_HALF + 1)
export const PX_PER_INDEX = 100;  // drag pixels per one album position

/**
 * Angle for a slot given its offset from center and the fractional index shift.
 * slotOffset: integer in [-POOL_HALF, POOL_HALF]
 * fractional: currentIndex - Math.round(currentIndex), in (-0.5, 0.5]
 * Returns angle in degrees (0 = top of ring, positive = clockwise).
 */
export function angleForSlot(slotOffset, fractional) {
  return (slotOffset - fractional) * ARC_STEP;
}

/** Polar to cartesian. Angle 0 = top (12 o'clock), positive = clockwise. */
export function angleToXY(angleDeg, radius) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
  };
}

/** Card rotation so it faces outward (tangent to the ring). */
export function tangentRotation(angleDeg) {
  return angleDeg;
}

/** Modulo wrap into [0, count). Handles negatives. */
export function wrapIndex(index, count) {
  return ((index % count) + count) % count;
}

/**
 * Returns array of { slotOffset, albumIndex } for the active slots.
 * Handles collections smaller than POOL_SIZE.
 */
export function visibleSlots(currentIndex, count) {
  if (count === 0) return [];
  const center = Math.round(currentIndex);
  const half = Math.min(POOL_HALF, Math.floor((count - 1) / 2));
  const slots = [];
  for (let offset = -half; offset <= half; offset++) {
    slots.push({
      slotOffset: offset,
      albumIndex: wrapIndex(center + offset, count),
    });
  }
  return slots;
}

/** Fractional part of currentIndex — drives smooth scrolling. */
export function fractionalOffset(currentIndex) {
  return currentIndex - Math.round(currentIndex);
}

/** Convert drag pixels to index delta. */
export function pxToIndexDelta(px) {
  return px / PX_PER_INDEX;
}
