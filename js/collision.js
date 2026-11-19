export function bodyHitsTrail(head, owner) {
  if (!head || !owner || head === owner || (head.id && owner.id && head.id === owner.id)) return false;
  const hitR = (head.r || 12) + owner.r * .78;
  const hitRSq = hitR * hitR;
  const hx = head.x, hy = head.y;
  const trail = owner.trail;
  for (let i = 14; i < trail.length; i += 4) {
    const point = trail[i];
    const dx = hx - point.x, dy = hy - point.y;
    if (dx * dx + dy * dy < hitRSq) return true;
  }
  return false;
}
export function touchesWorldWall(worm, world, margin = 24) {
  return worm.x <= margin || worm.y <= margin ||
    worm.x >= world.width - margin || worm.y >= world.height - margin;
}
