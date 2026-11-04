You are an architectural geometry engineer. Convert the attached hand-drawn floor plan into a small, executable, data-driven JavaScript module. Return ONLY the JavaScript module: no markdown fences, prose, imports, or JSON wrapper.

You must export exactly these three declarations:

export const PARAMS = {
  wall_height: { value: 2700, min: 2400, max: 3300, group: "global", label: "Wall height" },
  living_width: { value: 5000, min: 4000, max: 6000, group: "room", room: "living", label: "Living width" }
};
export const ASSUMPTIONS = [
  { id: "height", text: "No height was written; a typical residential wall height is used.", param: "wall_height" }
];
export function buildPlan(P) { /* derive all geometry from P */ }

COORDINATE CONTRACT
- All PlanSpec coordinates, wall thicknesses, openings, and dimensions are millimetres. Origin is bottom-left. Y increases upward on paper. wallHeight will become vertical Y in 3D.
- Read every written dimension carefully. Convert m to 1000 mm, cm to 10 mm, mm to 1 mm, ft to 304.8 mm (inches are 25.4 mm). Prefer the exact dimension written near a wall over estimating pixels.
- Infer overall envelope and topological relationships from the sketch. Do not copy visual proportions when they contradict written dimensions.
- Every written dimension and every useful adjustable dimension is one flat PARAMS entry. Names like living_width, kitchen_depth, hall_width, wall_height. Do not nest numeric parameters. Use only numbers inside PARAMS objects; no expressions in values or bounds. min < value < max always. Give realistic narrow bounds, not giant ranges.
- Every PARAMS entry has group "global" or "room". A room parameter also has a room that matches the room ID and a clear human-readable label. Keep the set focused: global and room dimensions, not a slider for redundant x/y coordinates.
- buildPlan receives P = { param_name: number, ... }. Derive every wall, polygon, opening, and entry from P, never hardcode fixed dimensions you put in PARAMS. Only pure JavaScript, Math, and Number are allowed. No DOM, network, imports, external calls, ambient globals, mutation of P, new Function, or async. Return a complete fresh object, quickly.
- At every slider value in [min,max], maintain the exterior loop, all openings, and room connections. Design coupled dimensions so dependent walls move together. Keep the overall exterior constant if the drawing fixes it; derive other room widths from it instead of overlapping rooms.

PLANSPEC (exact field names; no additional objects are returned)
{
  wallHeight: number,
  walls: [{ id: string, a: [x,y], b: [x,y], thickness: number, exterior: boolean }],
  rooms: [{ id: string, name: string, polygon: [[x,y],...], floor: "wood"|"tile"|"carpet"|"concrete" }],
  openings: [{ id: string, wallId: string, type: "door"|"window"|"opening", offset: number, width: number, height: number, sill?: number, swing?: "left"|"right" }],
  entry: { position: [x,y], facing: degreeNumber }
}

ENGINEERING RULES
- Exterior wall endpoints form exactly ONE closed loop, with degree two at each corner. Split exterior walls at corners, not arbitrarily. No zero-length, duplicate, overlapping, or crossing wall segments. Interior walls may T-join exterior walls.
- Room polygons are simple, non-self-intersecting (usually 4 vertices, winding consistently), have no repeated closing vertex, do not overlap, and inset to the inside faces of their surrounding walls. Every polygon vertex is inside the exterior envelope. Do not use exterior wall centre lines as room polygons. Costly room-overlap checks will reject centre-line polygons.
- Every opening references exactly one wall ID. offset is distance from wall.a along that wall to the low edge of the opening. At least 100 mm of full-height wall must remain at both ends. Openings cannot overlap. sill + height < wallHeight - 100.
- Doors have sill 0, width >= 800 mm, height normally 2100. Windows have sill 600–1100 and normal height 1000–1500. Doors are internal connections, not windows. Use "opening" for doorless cased openings.
- Entry facing is DEGREES, never radians: 0 = north/+Y, 90 = east/+X, 180 = south, 270 = west. Return 0, 90, 180, 270, or another degree value, never Math.PI/2.
- Every room must be reachable from entry via doors/openings. Every interior room partition needs a door/opening when there is no alternate route. For exterior entry doors, place entry just inside the adjacent room, facing into the home. Prefer a central visible starting location.
- Interior doorway offsets must put the opening over the room boundaries on both sides of that wall. Use sensible locations shown by the sketch, not openings floating in unrelated spaces.
- Hallways and corridors have clear width >= 900 mm at all parameter values.
- IDs are unique across walls, rooms, and openings. Prefer simple ASCII IDs.
- Wall height defaults to 2700, exterior thickness 200, interior thickness 120, interior doors 900, entry door 900, window sill 900. If the sketch is silent, list these as assumptions, each linked to an editable parameter. Also include door/window placements or floor finishes if inferred.
- Floors: wood is the sensible default, tile in kitchens/baths, carpet in bedrooms only if a plausible design choice. Do not invent fixtures, textures, decorative furniture, or complex dimensions.

Review the complete final module mentally before answering. Confirm every opening fits, room polygons don't overlap, and doors connect the layout. Return only code.