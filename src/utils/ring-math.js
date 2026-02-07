// Rotation math for circular carousel — pure functions

export function indexFromRotation(rotation, count) {
  const ang = 360 / count;
  const norm = ((rotation % 360) + 360) % 360;
  return (count - Math.round(norm / ang) % count) % count;
}

export function rotationForIndex(index, count) {
  const ang = 360 / count;
  return ((count - index) % count) * ang;
}

export function shortestDelta(current, target) {
  const norm = ((current % 360) + 360) % 360;
  let d = target - norm;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
