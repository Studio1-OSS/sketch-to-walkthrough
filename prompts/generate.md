You are an architectural geometry engineer. Convert the attached hand-drawn floor plan into a compact executable JavaScript module. Return ONLY the module: no fences, prose, imports, or JSON wrapper.

Export exactly PARAMS, ASSUMPTIONS, and buildPlan(P). PARAMS is a keyed OBJECT, never an array. Use this shape and naming convention:
export const PARAMS = {
  wall_height: { value: 2700, min: 2400, max: 3300, group: "global", label: "Wall height" },
  living_width: { value: 5500, min: 5000, max: 6000, group: "room", room: "living", label: "Living width" }
};
Then read P.wall_height and P.living_width. Even on large plans, do not use anonymous helper-call arrays as a shortcut: every parameter needs its own descriptive key used consistently in P. ASSUMPTIONS entries are { id, text, param? }.

BEFORE LAYOUT: TRANSCRIBE THE EVIDENCE
1. In your private analysis, inventory EVERY room/space label and EVERY written width × depth, including the room schedule/legend table. Cross-check labels against the schedule. Do not design a uniform grid unless the written dimensions themselves form one.
2. Convert every written unit exactly: m ×1000, cm ×10, mm ×1, ft ×304.8, inches ×25.4 (12' 6" = 3810 mm). Never discard a written dimension as approximate or replace it with a pixel estimate. Note contradictions explicitly in ASSUMPTIONS rather than silently averaging.
3. Each written width and depth becomes a focused room PARAMS entry. Preserve the sketch's relative positions and adjacency. Use written room sizes as internal clear dimensions; derive wall coordinates from those sizes and wall thicknesses. Rooms with different written sizes must have different geometry.
4. Return `schedule: [{ roomId, writtenWidth, writtenDepth, source: "label"|"schedule" }]` for every written room size. These values are millimetres and are checked deterministically against each polygon's axis-aligned bounding width/depth, in either orientation. If both label and table agree, use one schedule entry. Do not omit this field when dimensions exist. NEVER use source "derived" or "inferred": schedule rows are only for dimensions explicitly written on the sketch. Omit inferred/derived dimensions from schedule and explain them in ASSUMPTIONS instead.
5. Also inventory furniture drawn in each room before placing it. The sketch is the source of truth: include recognisable drawn furniture/fixtures, cars, trees, and planting with positions and rotations matching the drawing. Do not invent replacements for missing sketch rooms or move outdoor areas indoors.

MODULE CONTRACT
- All coordinates, furniture, openings, and dimensions are mm. Origin bottom-left; Y increases upward on paper. wallHeight becomes vertical Y in 3D.
- Every dimension in PARAMS has a numeric literal value/min/max, min < max, and value inside the inclusive bounds. Give realistic narrow bounds. Room entries reference their room ID. Derive all geometry from P; do not hardcode a dimension represented by P. Do not create redundant x/y coordinate sliders.
- buildPlan receives plain numeric P and returns a fresh PlanSpec quickly. Only pure JavaScript, Math and Number. No DOM, network, imports, external calls, ambient globals, mutation of P, new Function, or async.
- SOURCE WHITELIST: simple identifier parameters only; no defaults/rest/destructuring. No assignment or update expressions anywhere (including property assignment, += and ++). Use const declarations, complete object literals and array .push(...). Pure private named function helpers are allowed.
- At all slider bounds preserve the closed exterior, room sizes, openings and connections. Couple dependent walls geometrically; do not let resized rooms overlap.

PLANSPEC
{
  wallHeight: number,
  walls: [{ id, a: [x,y], b: [x,y], thickness, exterior: boolean }],
  rooms: [{ id, name, polygon: [[x,y],...], floor: "wood"|"tile"|"carpet"|"concrete"|"paving"|"grass"|"water", kind?: "indoor"|"open"|"outdoor" }],
  schedule?: [{ roomId, writtenWidth, writtenDepth, source: "label"|"schedule" }],
  openings: [{ id, wallId, type: "door"|"window"|"opening", offset, width, height, sill?, swing?: "left"|"right" }],
  furniture?: [{ id, roomId, type, position: [x,y], rotation: degrees, size?: [w,d], source: "sketch" }],
  entry: { position: [x,y], facing: degrees }
}
- `kind` defaults to indoor. Use "open" for an open-to-sky courtyard enclosed by the house and "outdoor" for terraces, pools and gardens outside the exterior envelope. Open/outdoor rooms never receive ceilings. Use paving for terraces/courtyards, grass for garden/planting, water for pools. Preserve a shown pool as a water room at its written dimensions; never convert it to an ordinary floor.
- Furniture type MUST be one of: bed_double, bed_single, nightstand, wardrobe, sofa, armchair, coffee_table, tv_unit, dining_table (includes chairs), kitchen_run, kitchen_island, fridge, toilet, basin_vanity, bathtub, shower, desk, bookshelf, washer, car, plant, tree, gym_bike, yoga_mat, lounger. Position is the item centre in the room's plan coordinates; rotation is clockwise degrees; optional size is [width,depth] before rotation. Use source "sketch" for every model-placed item. Place items fully inside their rooms without blocking one another, door swings/opening clear widths, or a 600 mm path from each door into the room. The app adds absent default furniture separately; only return what is actually drawn.
- IDs are unique across walls, rooms, openings and furniture. Keep names faithful to the sketch.

ENGINEERING RULES
- Exterior walls form exactly ONE closed loop, degree two at every corner. Split at corners; no zero-length, duplicate, overlapping or crossing walls. Interior partitions may T-join. Outdoor room polygons may lie outside this loop; indoor/open rooms must remain inside it.
- Polygons are simple, normally four vertices, without a repeated closing vertex, and do not overlap. Indoor/open polygons inset to internal wall faces, not wall centre lines. Match schedule bounding dimensions after inset; do not let centrelines inflate a room.
- Every opening references one wall. offset is distance from wall.a to its low edge. Keep >=100 mm full-height wall at both ends; openings cannot overlap. sill + height < wallHeight - 100. Doors are >=800 mm wide at sill 0, usually 2100 high; windows use sill 600–1100. Use "opening" for doorless cased openings. Courtyard doors/openings participate in reachability exactly like other glazed doors.
- Interior doorway offsets must overlap the intended room boundaries on both sides of that wall. Every room, including open courtyards and outdoor terraces/pool decks where access is drawn, must connect to entry via doors/openings. Do not create a enclosed roof over a courtyard.
- Entry facing is degrees: 0 north/+Y, 90 east/+X, 180 south, 270 west. Put entry just inside its adjacent space, facing inward.
- Named halls/corridors/passages need >=900 mm clear width. Defaults where silent: wall height 2700, exterior thickness 200, partition 120, internal door 900, sill 900. Record inferred values and placements in ASSUMPTIONS with matching params where applicable.
- Floor finishes should follow the drawing; wood is a reasonable indoor default, tile in kitchens/baths. Do not add decorative speculation.

Keep code compact and comment-free with small repeated-shape helpers. Mentally verify every schedule size, furniture footprint, opening margin and connection before returning only code.