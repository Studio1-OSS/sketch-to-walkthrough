import { roomCenter, type PlanSpec } from './plan';
import { checkFurnitureGeometry, roomHasDoorPaths } from './furniture';

export type Check = { id: string; title: string; ok: boolean; detail: string };
export type CheckResults = { checks: Check[]; failures: string[]; ok: boolean };
const EPS = 0.5;
const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const length = (a: [number, number], b: [number, number]) => distance(a, b);

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  const on = (p: [number, number], q: [number, number], r: [number, number]) => Math.min(p[0], r[0]) - EPS <= q[0] && q[0] <= Math.max(p[0], r[0]) + EPS && Math.min(p[1], r[1]) - EPS <= q[1] && q[1] <= Math.max(p[1], r[1]) + EPS;
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS)) ||
    (Math.abs(d1) <= EPS && on(c, a, d)) || (Math.abs(d2) <= EPS && on(c, b, d)) || (Math.abs(d3) <= EPS && on(a, c, b)) || (Math.abs(d4) <= EPS && on(a, d, b));
}
function pointOnSegment(p: [number, number], a: [number, number], b: [number, number]) {
  return distance(p, a) + distance(p, b) <= length(a, b) + EPS;
}
function pointInPolygon(point: [number, number], polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonArea(polygon: [number, number][]) {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
}
function polygonSimple(polygon: [number, number][]) {
  if (polygonArea(polygon) < 10000) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (distance(a, b) < EPS) return false;
    for (let j = i + 1; j < polygon.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false;
    }
  }
  return true;
}
function wallLoop(walls: PlanSpec['walls']) {
  const vertices = new Map<string, { point: [number, number]; count: number }>();
  const pointKey = (p: [number, number]) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  for (const wall of walls) {
    for (const point of [wall.a, wall.b]) {
      const key = pointKey(point), existing = vertices.get(key);
      if (existing) existing.count++; else vertices.set(key, { point, count: 1 });
    }
  }
  if ([...vertices.values()].some((v) => v.count !== 2)) return false;
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  for (const wall of walls) { link(pointKey(wall.a), pointKey(wall.b)); link(pointKey(wall.b), pointKey(wall.a)); }
  if (!adjacency.size) return false;
  const first = [...adjacency.keys()][0], visited = new Set([first]), queue = [first];
  while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  return visited.size === adjacency.size;
}

export function runChecks(plan: PlanSpec): CheckResults {
  const checks: Check[] = [];
  const add = (id: string, title: string, problems: string[], success: string) => checks.push({ id, title, ok: !problems.length, detail: problems.join(' ') || success });
  const badWalls: string[] = [];
  const ids = [...plan.walls.map((w) => w.id), ...plan.rooms.map((r) => r.id), ...plan.openings.map((o) => o.id)];
  if (new Set(ids).size !== ids.length) badWalls.push('Wall, room, and opening IDs must be globally unique.');
  for (const wall of plan.walls) if (length(wall.a, wall.b) < EPS) badWalls.push(`Wall ${wall.id} has zero length.`);
  for (let i = 0; i < plan.walls.length; i++) for (let j = i + 1; j < plan.walls.length; j++) {
    const a = plan.walls[i], b = plan.walls[j];
    if (segmentsIntersect(a.a, a.b, b.a, b.b)) {
      const collinear = [a.a, a.b].every((p) => Math.abs((b.b[0] - b.a[0]) * (p[1] - b.a[1]) - (b.b[1] - b.a[1]) * (p[0] - b.a[0])) < EPS);
      const onlyTouches = [a.a, a.b].some((p) => [b.a, b.b].some((q) => distance(p, q) < EPS)) ||
        [b.a, b.b].some((p) => [a.a, a.b].some((q) => distance(p, q) < EPS));
      const endpointTouch = [a.a, a.b].some((p) => pointOnSegment(p, b.a, b.b)) || [b.a, b.b].some((p) => pointOnSegment(p, a.a, a.b));
      if (collinear && !onlyTouches) badWalls.push(`Walls ${a.id} and ${b.id} overlap.`);
      else if (!endpointTouch) badWalls.push(`Walls ${a.id} and ${b.id} cross or overlap.`);
    }
  }
  const exterior = plan.walls.filter((w) => w.exterior);
  if (!wallLoop(exterior)) badWalls.push('Exterior wall endpoints must form one connected, closed loop (one wall in, one wall out at every corner).');
  add('walls', 'Structure & wall loop', badWalls, 'Exterior walls close cleanly. No crossing or overlapping walls.');

  const badRooms: string[] = [];
  // Exterior corners in arbitrary wall order are handled with a point-in-loop test below.
  const orderedExterior: [number, number][] = [];
  if (exterior.length) {
    const unused = [...exterior];
    let current = unused.shift()!;
    orderedExterior.push(current.a, current.b);
    while (unused.length) {
      const end = orderedExterior[orderedExterior.length - 1];
      const index = unused.findIndex((w) => distance(w.a, end) < EPS || distance(w.b, end) < EPS);
      if (index < 0) break;
      const next = unused.splice(index, 1)[0];
      orderedExterior.push(distance(next.a, end) < EPS ? next.b : next.a);
    }
  }
  for (let i = 0; i < plan.rooms.length; i++) {
    const room = plan.rooms[i];
    if (!polygonSimple(room.polygon)) badRooms.push(`Room ${room.id} has a self-intersecting, zero-length, or near-zero-area polygon.`);
    if (orderedExterior.length >= 4 && exterior.length > 3) {
      if (room.kind !== 'outdoor' && !room.polygon.every((p) => pointInPolygon(p, orderedExterior))) badRooms.push(`Room ${room.id} extends outside the exterior envelope.`);
    }
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const other = plan.rooms[j];
      const edgesCross = room.polygon.some((a, k) => other.polygon.some((c, l) => {
        const b = room.polygon[(k + 1) % room.polygon.length], d = other.polygon[(l + 1) % other.polygon.length];
        // Shared wall boundaries are expected; true edge crossings are not.
        const shared = (distance(a, c) < EPS && distance(b, d) < EPS) || (distance(a, d) < EPS && distance(b, c) < EPS);
        return !shared && segmentsIntersect(a, b, c, d);
      }));
      if (edgesCross || pointInPolygon(roomCenter(room.polygon), other.polygon) || pointInPolygon(roomCenter(other.polygon), room.polygon)) badRooms.push(`Rooms ${room.id} and ${other.id} overlap.`);
    }
  }
  add('rooms', 'Room geometry', badRooms, 'Room polygons are valid, non-overlapping; outdoor areas may extend beyond the exterior.');

  const badSizes: string[] = [], scheduledRooms = new Set<string>();
  for (const entry of plan.schedule ?? []) {
    const room = plan.rooms.find((r) => r.id === entry.roomId);
    if (!room) { badSizes.push(`Schedule references missing room ${entry.roomId}.`); continue; }
    if (scheduledRooms.has(room.id)) badSizes.push(`Room ${room.name} has duplicate written-size entries.`);
    scheduledRooms.add(room.id);
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    const actual: [number, number] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const written: [number, number] = [entry.writtenWidth, entry.writtenDepth];
    const matches = [[actual[0], actual[1]], [actual[1], actual[0]]].some((oriented) => oriented.every((value, axis) => {
      const tolerance = Math.max(150, written[axis] * 0.1);
      return Math.abs(value - written[axis]) <= tolerance + 0.001;
    }));
    if (!matches) badSizes.push(`Room ${room.name} is ${Math.round(actual[0])} × ${Math.round(actual[1])} mm; written size is ${entry.writtenWidth} × ${entry.writtenDepth} mm (±10% or ±150 mm, whichever is larger, either orientation).`);
  }
  add('sizes', 'Written room sizes', badSizes, plan.schedule?.length ? `${plan.schedule.length} written room sizes match their polygons within tolerance.` : 'No written room-size schedule was supplied.');

  const badOpenings: string[] = [], wallById = new Map(plan.walls.map((w) => [w.id, w]));
  for (const opening of plan.openings) {
    const wall = wallById.get(opening.wallId);
    if (!wall) { badOpenings.push(`Opening ${opening.id} references missing wall ${opening.wallId}.`); continue; }
    const wallLength = length(wall.a, wall.b);
    if (opening.offset < 100 || opening.offset + opening.width > wallLength - 100) badOpenings.push(`Opening ${opening.id} must fit its wall with at least 100 mm at both ends.`);
    if (opening.sill! + opening.height > plan.wallHeight - 100) badOpenings.push(`Opening ${opening.id} extends through the top of its wall.`);
    if (opening.type === 'door') {
      if (opening.width < 800) badOpenings.push(`Door ${opening.id} is ${opening.width} mm; doors need at least 800 mm.`);
      if ((opening.sill ?? 0) > 10) badOpenings.push(`Door ${opening.id} needs a sill at floor level.`);
    }
    if (opening.type === 'window' && (opening.sill === undefined || opening.sill < 600 || opening.sill > 1100)) badOpenings.push(`Window ${opening.id} needs a sill between 600 and 1100 mm.`);
    for (const other of plan.openings) if (other.id !== opening.id && other.wallId === opening.wallId && opening.offset < other.offset + other.width && other.offset < opening.offset + opening.width) badOpenings.push(`Openings ${opening.id} and ${other.id} overlap.`);
  }
  add('openings', 'Openings & clearances', badOpenings, 'Doors are ≥ 800 mm; windows have 600–1100 mm sills; every opening fits.');

  const reachability: string[] = [];
  if (!pointInPolygon(plan.entry.position, orderedExterior)) reachability.push('Entry is not inside the exterior envelope.');
  const adjacency = new Map<string, Set<string>>(plan.rooms.map((r) => [r.id, new Set()]));
  for (const opening of plan.openings) {
    if (opening.type === 'window') continue;
    const wall = wallById.get(opening.wallId); if (!wall) continue;
    const mid: [number, number] = [wall.a[0] + (wall.b[0] - wall.a[0]) * (opening.offset + opening.width / 2) / length(wall.a, wall.b), wall.a[1] + (wall.b[1] - wall.a[1]) * (opening.offset + opening.width / 2) / length(wall.a, wall.b)];
    const tangent: [number, number] = [(wall.b[0] - wall.a[0]) / length(wall.a, wall.b), (wall.b[1] - wall.a[1]) / length(wall.a, wall.b)];
    const samples: [number, number][] = [[mid[0] - tangent[1] * (wall.thickness + 30), mid[1] + tangent[0] * (wall.thickness + 30)], [mid[0] + tangent[1] * (wall.thickness + 30), mid[1] - tangent[0] * (wall.thickness + 30)]];
    const touching = samples.map((p) => plan.rooms.find((r) => pointInPolygon(p, r.polygon))?.id).filter((id): id is string => !!id);
    for (const a of touching) for (const b of touching) if (a !== b) { adjacency.get(a)?.add(b); adjacency.get(b)?.add(a); }
    if (!touching.length && wall.exterior) {
      const outside = samples.find((p) => !pointInPolygon(p, orderedExterior));
      const inside = samples.find((p) => pointInPolygon(p, orderedExterior));
      const room = inside && plan.rooms.find((r) => pointInPolygon(rCenter(r.polygon), r.polygon) && pointInPolygon(inside, r.polygon));
      if (outside && room) adjacency.get(room.id)?.add('__outside__');
    }
  }
  adjacency.set('__outside__', new Set());
  for (const [room, neighbors] of adjacency) for (const neighbor of neighbors) adjacency.get(neighbor)?.add(room);
  const start = plan.rooms.find((r) => pointInPolygon(plan.entry.position, r.polygon))?.id ?? '__outside__';
  const reached = new Set([start]), queue = [start];
  while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  for (const room of plan.rooms) if (!reached.has(room.id)) reachability.push(`Room ${room.name} is not reachable from the entry through doors or openings.`);
  for (const room of plan.rooms.filter((r) => /hall|corridor|passage/i.test(r.name))) {
    const minWidth = Math.min(...room.polygon.map((a, i) => {
      const b = room.polygon[(i + 1) % room.polygon.length];
      return room.polygon.filter((_, j) => j !== i && j !== (i + 1) % room.polygon.length).map((p) => pointSegmentDistance(p, a, b));
    }).flat());
    if (minWidth < 900) reachability.push(`Hallway ${room.name} is only ${Math.round(minWidth)} mm wide; minimum is 900 mm.`);
  }
  add('access', 'Access from entry', reachability, 'Every room connects to the entry. Hallway clearances are at least 900 mm.');

  const badFurniture = checkFurnitureGeometry(plan).map((issue) => `Furniture ${issue.itemId} ${issue.message}`);
  for (const room of plan.rooms) if (!roomHasDoorPaths(room, plan)) badFurniture.push(`Room ${room.name} has no 600 mm walkable path from every door into the room around its furniture.`);
  const sketchCount = plan.furniture.filter((f) => f.source === 'sketch').length, autoCount = plan.furniture.length - sketchCount;
  add('furniture', 'Furniture & circulation', badFurniture, plan.furniture.length ? `${plan.furniture.length} items fit their rooms, avoid openings and preserve 600 mm paths (${sketchCount} from sketch, ${autoCount} added by default).` : 'No furniture placed; circulation is unobstructed.');
  const failures = checks.filter((c) => !c.ok).flatMap((c) => [`${c.title}: ${c.detail}`]);
  return { checks, failures, ok: !failures.length };
}

export function pointSegmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const l2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  if (!l2) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
  return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
}

// Alias keeps the reachability predicate readable above.
const rCenter = roomCenter;
