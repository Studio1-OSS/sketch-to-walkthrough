import { describe, expect, it } from 'vitest';
import { buildFromModule } from './module';
import { SAMPLE_SOURCE } from './sample';
import { FURNITURE_TYPES, furnitureSchema, planSchema, type FurnitureItem, type PlanSpec } from './plan';
import { applyFurnishing, autoFurnish, checkFurnitureGeometry, FURNITURE_CATALOGUE, furnitureClearOfOpenings, furnitureInsideRoom, itemDimensions, roomHasDoorPaths, openingClearPolygons, doorSwingPolygons, itemRect, polygonsIntersect } from './furniture';
import { runChecks } from './checks';
import { collides } from './walkthrough';
import { planToSVG } from './plan-svg';

const base = () => structuredClone(buildFromModule(SAMPLE_SOURCE).plan);
const item = (value: Partial<FurnitureItem> = {}): FurnitureItem => furnitureSchema.parse({ id: 'test_item', roomId: 'living', type: 'nightstand', position: [2600, 1900], rotation: 0, source: 'sketch', ...value });
const furnitureIds = (plan: PlanSpec) => checkFurnitureGeometry(plan).map((issue) => `${issue.itemId} ${issue.message}`).join(' ');

describe('written-size checks', () => {
  it('accepts bounding dimensions in the written orientation', () => {
    const plan = base(), room = plan.rooms.find((r) => r.id === 'living')!;
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    plan.schedule = [{ roomId: room.id, writtenWidth: Math.max(...xs) - Math.min(...xs), writtenDepth: Math.max(...ys) - Math.min(...ys), source: 'label' }];
    expect(runChecks(plan).checks.find((c) => c.id === 'sizes')!.ok).toBe(true);
  });
  it('accepts reversed width/depth and ten percent tolerance', () => {
    const plan = base(), room = plan.rooms[0];
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    plan.schedule = [{ roomId: room.id, writtenWidth: (Math.max(...ys) - Math.min(...ys)) * 1.1, writtenDepth: (Math.max(...xs) - Math.min(...xs)) * 1.1, source: 'schedule' }];
    expect(runChecks(plan).checks.find((c) => c.id === 'sizes')!.ok).toBe(true);
  });
  it('uses 150 mm when larger than ten percent', () => {
    const plan = base(), room = plan.rooms[0];
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    plan.schedule = [{ roomId: room.id, writtenWidth: Math.max(...xs) - Math.min(...xs) + 149, writtenDepth: Math.max(...ys) - Math.min(...ys) - 149, source: 'label' }];
    expect(runChecks(plan).checks.find((c) => c.id === 'sizes')!.ok).toBe(true);
  });
  it('rejects a clearly wrong room size with useful text', () => {
    const plan = base();
    plan.schedule = [{ roomId: 'bedroom2', writtenWidth: 5000, writtenDepth: 5000, source: 'label' }];
    const check = runChecks(plan).checks.find((c) => c.id === 'sizes')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('Bedroom 02');
    expect(check.detail).toContain('written size is 5000 × 5000 mm');
    expect(runChecks(plan).failures.join(' ')).toContain('Written room sizes');
  });
  it('rejects schedule references to missing rooms', () => {
    const plan = base(); plan.schedule = [{ roomId: 'missing', writtenWidth: 4000, writtenDepth: 3000, source: 'schedule' }];
    expect(runChecks(plan).checks.find((c) => c.id === 'sizes')!.detail).toContain('missing room');
  });
});

describe('open and outdoor spaces', () => {
  it('supports open/outdoor kinds and the three new floor types', () => {
    const plan = base();
    plan.rooms[0] = { ...plan.rooms[0], kind: 'open', floor: 'paving' };
    plan.rooms[1] = { ...plan.rooms[1], kind: 'outdoor', floor: 'water' };
    plan.rooms[2] = { ...plan.rooms[2], kind: 'outdoor', floor: 'grass' };
    expect(planSchema.parse(plan).rooms.map((r) => r.kind)).toEqual(['open', 'outdoor', 'outdoor', 'indoor', 'indoor']);
  });
  it('exempts outdoor rooms from the exterior envelope check', () => {
    const plan = base();
    plan.rooms[0].kind = 'outdoor'; plan.rooms[0].floor = 'paving';
    plan.rooms[0].polygon = plan.rooms[0].polygon.map(([x, y]) => [x - 12000, y]);
    expect(runChecks(plan).checks.find((c) => c.id === 'rooms')!.ok).toBe(true);
  });
  it('does not exempt an indoor or open room outside the envelope', () => {
    for (const kind of ['indoor', 'open'] as const) {
      const plan = base(); plan.rooms[0].kind = kind;
      plan.rooms[0].polygon = plan.rooms[0].polygon.map(([x, y]) => [x - 12000, y]);
      expect(runChecks(plan).checks.find((c) => c.id === 'rooms')!.ok).toBe(false);
    }
  });
});

describe('furniture validation and deterministic checks', () => {
  it('accepts every catalogue type and provides positive defaults', () => {
    expect(FURNITURE_TYPES).toHaveLength(25);
    for (const type of FURNITURE_TYPES) {
      const definition = FURNITURE_CATALOGUE[type];
      expect(definition.width).toBeGreaterThan(0); expect(definition.depth).toBeGreaterThan(0);
      expect(furnitureSchema.parse({ id: type, roomId: 'living', type, position: [1, 2], rotation: 0 })).toMatchObject({ type, source: 'sketch' });
    }
  });
  it('rejects unknown types, malformed positions and unsafe dimensions', () => {
    expect(furnitureSchema.safeParse({ id: 'x', roomId: 'r', type: 'avalanche', position: [0, 0] }).success).toBe(false);
    expect(furnitureSchema.safeParse({ id: 'x', roomId: 'r', type: 'sofa', position: [0] }).success).toBe(false);
    expect(furnitureSchema.safeParse({ id: 'x', roomId: 'r', type: 'sofa', position: [0, 0], size: [-1, 0] }).success).toBe(false);
  });
  it('checks a footprint fully inside its room, including rotation', () => {
    expect(furnitureInsideRoom(item(), base().rooms[0])).toBe(true);
    expect(furnitureInsideRoom(item({ position: [50, 100] }), base().rooms[0])).toBe(false);
    expect(furnitureInsideRoom(item({ position: [5350, 300], rotation: 90, size: [500, 1000] }), base().rooms[0])).toBe(false);
  });
  it('reports an item outside its room', () => {
    const plan = base(); plan.furniture = [item({ position: [50, 100] })];
    expect(furnitureIds(plan)).toContain('not fully inside');
  });
  it('reports missing opening walls without throwing during furnishing or checks', () => {
    const plan = base(); plan.openings[0].wallId = 'missing_wall'; plan.furniture = [item()];
    expect(() => applyFurnishing(plan, true)).not.toThrow();
    expect(runChecks(plan).failures.join(' ')).toContain('missing wall missing_wall');
  });
  it('keeps generated IDs unique and within schema limits for long room IDs', () => {
    const plan = base(); plan.rooms[0].id = 'r'.repeat(80);
    expect(() => autoFurnish(plan)).not.toThrow();
    const furnished = autoFurnish(plan);
    expect(furnished.furniture.every((f) => f.id.length <= 100)).toBe(true);
    expect(new Set(furnished.furniture.map((f) => f.id)).size).toBe(furnished.furniture.length);
  });
  it('furnishes a dressing room with wardrobes', () => {
    const plan = base(); plan.rooms[0].name = 'Dressing';
    expect(autoFurnish(plan).furniture.filter((f) => f.roomId === 'living' && f.type === 'wardrobe').length).toBeGreaterThan(0);
  });
  it('reports an unknown room and duplicate IDs', () => {
    const plan = base(); plan.furniture = [item({ roomId: 'nowhere' }), item({ id: 'living' }), item({ id: 'duplicate' }), item({ id: 'duplicate' })];
    const messages = furnitureIds(plan);
    expect(messages).toContain('missing room'); expect(messages).toContain('unique');
  });
  it('reports every overlapping pair in the same room', () => {
    const plan = base(); plan.furniture = [item(), item({ id: 'second', rotation: 90 })];
    expect(furnitureIds(plan)).toContain('test_item / second overlap');
  });
  it("checks a door's swing arc independently of the clear-width strip", () => {
    const plan = base(), obstruction = item({ position: [4875, 1600], size: [200, 200] });
    expect(doorSwingPolygons(plan).some((zone) => zone.opening.id === 'living_door' && polygonsIntersect(itemRect(obstruction).corners, zone.polygon))).toBe(true);
    expect(openingClearPolygons(plan).some((zone) => polygonsIntersect(itemRect(obstruction).corners, zone.polygon))).toBe(false);
    plan.furniture = [obstruction];
    expect(furnitureClearOfOpenings(obstruction, plan)).toBe(false);
    expect(furnitureIds(plan)).toContain('door swing or opening clear width');
  });
  it("checks an opening's clear width independently of its swing", () => {
    const plan = base(), obstruction = item({ id: 'opening_block', roomId: 'hall', position: [5800, 1450], size: [400, 200] });
    expect(openingClearPolygons(plan).some((zone) => zone.opening.id === 'living_door' && polygonsIntersect(itemRect(obstruction).corners, zone.polygon))).toBe(true);
    expect(doorSwingPolygons(plan).some((zone) => zone.opening.id === 'living_door' && polygonsIntersect(itemRect(obstruction).corners, zone.polygon))).toBe(false);
    expect(furnitureClearOfOpenings(obstruction, plan)).toBe(false);
  });
  it('checks a 600 mm path from a door into the room', () => {
    const plan = base(); plan.furniture = [item({ type: 'wardrobe', position: [2750, 1900], size: [4900, 3200] })];
    expect(roomHasDoorPaths(plan.rooms[0], plan)).toBe(false);
    expect(runChecks(plan).failures.join(' ')).toContain('600 mm walkable path');
  });
});

describe('auto-furnishing', () => {
  it('adds safe defaults by room name and satisfies every furniture check', () => {
    const plan = autoFurnish(base());
    expect(plan.furniture.length).toBeGreaterThan(8);
    expect(plan.furniture.every((f) => f.source === 'auto' && f.id.startsWith('auto_'))).toBe(true);
    expect(checkFurnitureGeometry(plan)).toEqual([]);
    expect(runChecks(plan).checks.find((c) => c.id === 'furniture')!.ok).toBe(true);
    expect(plan.rooms.filter((r) => /bedroom|living|kitchen/i.test(r.name)).every((room) => plan.furniture.some((f) => f.roomId === room.id))).toBe(true);
  });
  it('drops a default rather than violate a crowded sketch layout', () => {
    const plan = base(), existing = item({ type: 'wardrobe', position: [2750, 1900], size: [4900, 3200] });
    plan.furniture = [existing];
    const furnished = autoFurnish(plan);
    expect(furnished.furniture.find((f) => f.id === existing.id)).toEqual(existing);
    expect(furnished.furniture.filter((f) => f.roomId === 'living')).toHaveLength(1);
  });
  it('toggle removes defaults but preserves items from the sketch', () => {
    const plan = base(); plan.furniture = [item()];
    const enabled = applyFurnishing(plan, true), disabled = applyFurnishing(enabled, false);
    expect(enabled.furniture.some((f) => f.source === 'auto')).toBe(true);
    expect(disabled.furniture).toHaveLength(1); expect(disabled.furniture[0].source).toBe('sketch');
  });
  it('is deterministic', () => { expect(autoFurnish(base())).toEqual(autoFurnish(base())); });
});

describe('furniture collision and plan output', () => {
  it('blocks furniture footprints but not yoga mats', () => {
    const plan = base(); plan.furniture = [item({ position: [2500, 1900] })];
    expect(collides([2500, 1900], plan)).toBe(true);
    expect(collides([2500, 3000], plan)).toBe(false);
    plan.furniture = [item({ type: 'yoga_mat' })];
    expect(collides([2500, 1900], plan)).toBe(false);
  });
  it('uses rotated furniture collision footprints', () => {
    const plan = base(); plan.furniture = [item({ type: 'bed_double', position: [2500, 1900], rotation: 90 })];
    expect(collides([3500, 1900], plan)).toBe(true);
    expect(collides([2500, 3400], plan)).toBe(false);
  });
  it('draws furniture symbols and clips fitted room labels to each polygon', () => {
    const plan = applyFurnishing(base(), true), svg = planToSVG(plan, { width: 1200 });
    expect(svg.match(/class="furniture-symbol"/g)!.length).toBe(plan.furniture.length);
    expect(svg.match(/clipPath id="room-label-/g)).toHaveLength(plan.rooms.length);
    expect(svg).toContain('g clip-path="url(#room-label-');
    expect(svg).toContain('Bedroom 02');
    expect(svg).not.toMatch(/<rect[^>]*fill="[^"]*"[^>]*fill="[^"]*"/);
  });
  it('produces one fill attribute for every catalogue symbol, including a basin', () => {
    const plan = base(); plan.furniture = [item({ type: 'basin_vanity' })];
    const svg = planToSVG(plan, { width: 1200 });
    expect(svg).not.toMatch(/<rect[^>]*fill="[^"]*"[^>]*fill="[^"]*"/);
    expect(svg).not.toMatch(/<ellipse[^>]*fill="[^"]*"[^>]*fill="[^"]*"/);
  });
  it('has stable dimensions for optional custom furniture sizes', () => {
    expect(itemDimensions(item({ type: 'bed_double' }))).toEqual([1700, 2150]);
    expect(itemDimensions(item({ size: [1234, 2345] }))).toEqual([1234, 2345]);
  });
});
